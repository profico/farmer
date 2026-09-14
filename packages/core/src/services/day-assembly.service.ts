import { and, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import { account } from "../db/schema/auth";
import { project, type TaskSystemKey, timeEntry } from "../db/schema/domain";
import {
	commitFillTombstone,
	syncedMeetingTombstone,
} from "../db/schema/settings";
import { splitProportionally, summarizeCommitMessages } from "../lib/day-plan";
import {
	describePullRequestActivity,
	type PullRequestActivityKind,
} from "../lib/github-activity";
import { QUARTER_HOUR_SECONDS, snapToQuarterHour } from "../lib/time";
import {
	loggedSeconds,
	remainingSeconds,
	spokenForSeconds,
	targetSecondsFor,
} from "../lib/working-day";
import type {
	ApplyDayAssemblyInput,
	SuggestDayAssemblyInput,
} from "../schema/day-assembly";
import { ctxAccess, ctxTimezone } from "./context";
import {
	githubService,
	type ScannedPullRequestActivity,
} from "./github.service";
import { holidaysService } from "./holidays.service";
import { calendarSource, commitSource, pullRequestSource } from "./ports";
import {
	deletedReviewsOnDay,
	REVIEW_BLOCK_SECONDS,
	reviewBlockDescription,
	reviewHomesOnDay,
} from "./pr-reviews";
import { tasksService } from "./tasks.service";
import {
	assertDayHasRoom,
	DayCapacityError,
	timeEntriesService,
} from "./time-entries.service";
import type { Ctx } from "./types";
import { workingHoursService } from "./working-hours.service";

// "Assemble my day": gather every signal we have about a day (calendar meetings,
// GitHub commits per project, working hours) and propose the entries that would
// complete it. This is the same bet as the Slack nudges — the biggest cause of
// bad data is people forgetting, and the cheapest fix is having the day mostly
// filled in before they arrive.
//
// Under the duration-only entry model this service proposes AMOUNTS, not slots:
// the old timeline-placement half (gap finding, break insertion at a clock time,
// sort by start time) had no meaning once entries stopped carrying a time of day
// and was removed. What survives is the discovery half, which was always the
// valuable part.

// A workday longer than this legally requires a rest break (Croatian Labour Act
// art. 73: >6h/day → a paid break counted within working time), so the break is
// carved out of the day's target rather than added on top of it.
const BREAK_MIN_WORKDAY_SECONDS = 6 * 60 * 60;
const DEFAULT_BREAK_SECONDS = 30 * 60;

export type DaySuggestionCommit = {
	projectGithubRepoId: string;
	sha: string;
	message: string;
	repoFullName: string;
};

export type DaySuggestionPullRequest = {
	projectGithubRepoId: string;
	number: number;
	title: string;
	repoFullName: string;
	/** What the person did on it that day, oldest first. */
	kinds: PullRequestActivityKind[];
};

/** One project's evidence for the day — what its work suggestion is built from. */
type ProjectEvidence = {
	commits: Awaited<ReturnType<typeof githubService.listUserCommitsForDay>>;
	pullRequests: DaySuggestionPullRequest[];
};

export type DaySuggestion = {
	/** Stable client-side key: "meeting:<eventId>" | "work:<projectId>" |
	 *  "review:<pullRequestUrl>" | "break" | "fill". */
	key: string;
	kind: "meeting" | "work" | "review" | "break" | "fill";
	taskId: string;
	taskName: string;
	projectId: string | null;
	projectName: string | null;
	description: string;
	durationSeconds: number;
	fillsDay: boolean;
	meetingUrl: string | null;
	calendarEventId: string | null;
	commits: DaySuggestionCommit[];
	pullRequests: DaySuggestionPullRequest[];
	/**
	 * This one is only here because `includeDismissed` was asked for: the person
	 * deleted it before, and the sync engines have been told to leave it alone.
	 *
	 * Carried per suggestion rather than inferred from the flag so the dialog can
	 * offer these UNSELECTED. Everything else in this list arrives ticked, which
	 * is right for a screen whose job is one-click assembly and wrong for a row
	 * the person already said no to once — turning the switch on to find one
	 * mistake should not silently re-add the four deletions that were deliberate.
	 */
	dismissed: boolean;
};

export type DayAssembly = {
	date: string;
	targetSeconds: number;
	loggedSeconds: number;
	suggestions: DaySuggestion[];
	// "unavailable" means the account isn't connected, so that signal was
	// silently empty — the UI uses it to hint at connecting the integration.
	sources: {
		calendar: "ok" | "unavailable";
		github: "ok" | "unavailable";
	};
	/**
	 * How many suggestions this day is holding back because they were deleted
	 * before — the count `includeDismissed` would add.
	 *
	 * Reported rather than left implicit so the dialog can offer the toggle only
	 * on a day that has something behind it. A switch that is always visible and
	 * usually does nothing teaches people to ignore it; one that appears saying
	 * "2 you deleted" is an answer to a question they are already asking.
	 *
	 * Counted even when `includeDismissed` is on, so the toggle doesn't erase its
	 * own reason for existing the moment it's used.
	 */
	dismissedCount: number;
};

const hasLinkedAccount = async (userId: string, providerId: string) => {
	const row = await db.query.account.findFirst({
		where: and(eq(account.userId, userId), eq(account.providerId, providerId)),
		columns: { id: true },
	});
	return !!row;
};

/** Look up one of the tasks this engine proposes against — the assembler can
 *  only suggest entries the user could have created by hand, so it needs real
 *  task rows.
 *
 *  Resolved by system key rather than display name: `meeting` and `break` are
 *  site built-ins, `development` is org-scoped and freely renameable, and under
 *  the old name match renaming any of them switched off the corresponding half
 *  of the assembler with no error anywhere. */
const findEngineTask = (ctx: Ctx, key: TaskSystemKey) =>
	tasksService.findBySystemKey(ctx, key);

export const dayAssemblyService = {
	/** Read-only preview: nothing here writes. It used to run the recurring
	 *  materializer first, back when every time-page read did too; the worker
	 *  owns materialization now, and a preview that files entries as a side
	 *  effect of being previewed is the exact thing we removed. A day whose
	 *  recurring break has not materialized yet simply gets one proposed below,
	 *  which is what the break branch has always done. */
	suggest: async (
		ctx: Ctx,
		input: SuggestDayAssemblyInput,
	): Promise<DayAssembly> => {
		const { date, includeDismissed = false } = input;

		const tz = await ctxTimezone(ctx);

		const [
			existing,
			workingHours,
			meetingTask,
			workTask,
			breakTask,
			reviewTask,
			calendarEvents,
			commits,
			pullRequestEvents,
			calendarLinked,
			githubLinked,
			holidays,
		] = await Promise.all([
			db.query.timeEntry.findMany({
				where: and(
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
					eq(timeEntry.date, date),
				),
				columns: {
					durationSeconds: true,
					fillsDay: true,
					calendarEventId: true,
					taskId: true,
					projectId: true,
				},
			}),
			workingHoursService.list(ctx),
			findEngineTask(ctx, "meeting"),
			findEngineTask(ctx, "development"),
			findEngineTask(ctx, "break"),
			findEngineTask(ctx, "code_review"),
			calendarSource()
				.listEventsForRange(ctx, { from: date, to: date })
				.catch((error) => {
					console.error("[day-assembly] calendar read failed", error);
					return null;
				}),
			commitSource()
				.listUserCommitsForDay(ctx, date)
				.catch((error) => {
					console.error("[day-assembly] commit read failed", error);
					return [];
				}),
			pullRequestSource()
				.listUserPullRequestActivityForDay(ctx, date)
				.catch((error) => {
					console.error("[day-assembly] pull request read failed", error);
					return [];
				}),
			// "google-calendar", not "google": the plain Google provider is only a
			// sign-in link and carries no calendar scope, so checking it reported
			// "connect your calendar" at people who had already connected it.
			hasLinkedAccount(ctx.userId, "google-calendar"),
			hasLinkedAccount(ctx.userId, "github"),
			// The assembler proposes the same rest-of-day block the commit engine
			// files, so it has to agree with it about whether the day is a working
			// day at all. On a public holiday the target is 0 and the whole
			// suggestion list collapses to nothing, which is the correct answer.
			holidaysService.holidaySetForRange(ctx, date, date),
		]);

		const targetSeconds = targetSecondsFor(workingHours, date, tz, holidays);
		const logged = loggedSeconds(existing);
		const spokenFor = spokenForSeconds(existing);

		const suggestions: DaySuggestion[] = [];
		// Everything `includeDismissed` would add back, whether or not it is on.
		let dismissedCount = 0;

		// ── Meetings: calendar events not already logged ────────────────────────
		let meetingSeconds = 0;
		if (calendarEvents && calendarEvents.length > 0 && meetingTask) {
			const tombstones = await db.query.syncedMeetingTombstone.findMany({
				where: and(
					eq(syncedMeetingTombstone.organizationId, ctx.organizationId),
					eq(syncedMeetingTombstone.userId, ctx.userId),
				),
				columns: { calendarEventId: true },
			});
			// Two different reasons to leave an event out, and only one of them is a
			// decision the toggle may override. A tombstoned meeting was deleted; a
			// meeting already on an entry is simply here, and re-proposing it would
			// offer a duplicate no matter what the toggle says.
			const deletedIds = new Set(tombstones.map((t) => t.calendarEventId));
			const loggedIds = new Set(
				existing
					.map((e) => e.calendarEventId)
					.filter((id): id is string => id !== null),
			);

			for (const event of calendarEvents) {
				if (loggedIds.has(event.id)) continue;
				if (deletedIds.has(event.id)) {
					dismissedCount++;
					if (!includeDismissed) continue;
				}
				const raw = Math.floor(
					(new Date(event.end).getTime() - new Date(event.start).getTime()) /
						1000,
				);
				if (raw <= 0) continue;
				const durationSeconds = snapToQuarterHour(raw);
				meetingSeconds += durationSeconds;
				suggestions.push({
					key: `meeting:${event.id}`,
					kind: "meeting",
					taskId: meetingTask.id,
					taskName: meetingTask.name,
					projectId: null,
					projectName: null,
					description: event.title,
					durationSeconds,
					fillsDay: false,
					meetingUrl: event.meetingUrl,
					calendarEventId: event.id,
					commits: [],
					pullRequests: [],
					dismissed: deletedIds.has(event.id),
				});
			}
		}

		// ── Break: carved out of the day, not added on top ──────────────────────
		let breakSeconds = 0;
		const preBreakRemaining = remainingSeconds(
			targetSeconds,
			spokenFor,
			meetingSeconds,
		);
		const alreadyHasBreak =
			breakTask != null && existing.some((e) => e.taskId === breakTask.id);
		if (
			breakTask &&
			!alreadyHasBreak &&
			targetSeconds > BREAK_MIN_WORKDAY_SECONDS &&
			preBreakRemaining > DEFAULT_BREAK_SECONDS
		) {
			breakSeconds = DEFAULT_BREAK_SECONDS;
			suggestions.push({
				key: "break",
				kind: "break",
				taskId: breakTask.id,
				taskName: breakTask.name,
				projectId: null,
				projectName: null,
				description: "Break",
				durationSeconds: breakSeconds,
				fillsDay: false,
				meetingUrl: null,
				calendarEventId: null,
				commits: [],
				pullRequests: [],
				// A recurring-break skip is a rule adjusted for one day, not a row
				// lost, so the toggle deliberately doesn't cover it — see the note on
				// `includeDismissed` in schema/day-assembly. This branch never
				// suppresses anything, so nothing here is ever held back.
				dismissed: false,
			});
		}

		const beforeReviews = remainingSeconds(
			targetSeconds,
			spokenFor,
			meetingSeconds,
			breakSeconds,
		);

		// ── Reviews: one block per reviewed pull request ────────────────────────
		//
		// The block the commit engine files (see ./pr-reviews), proposed here so
		// a day assembled by hand agrees with a day synced overnight. A review
		// that is already on an entry, or on a project with a Code Review entry,
		// is accounted for and proposes nothing. A review that gets no block
		// stays evidence for the project's work suggestion below.
		let reviewSeconds = 0;
		const accountedReviews = new Set<string>();
		const reviews = reviewTask
			? pullRequestEvents.filter((event) => event.kind === "reviewed")
			: [];
		if (reviewTask && reviews.length > 0) {
			const byPullRequest = new Map<string, ScannedPullRequestActivity[]>();
			for (const review of reviews) {
				byPullRequest.set(review.pullRequestUrl, [
					...(byPullRequest.get(review.pullRequestUrl) ?? []),
					review,
				]);
			}
			const [homes, deleted, access, projects] = await Promise.all([
				reviewHomesOnDay(ctx, date),
				deletedReviewsOnDay(ctx, date),
				ctxAccess(ctx),
				db.query.project.findMany({
					where: and(
						eq(project.organizationId, ctx.organizationId),
						inArray(project.id, [
							...new Set(reviews.map((review) => review.projectId)),
						]),
					),
					columns: { id: true, name: true },
				}),
			]);
			const nameById = new Map(projects.map((p) => [p.id, p.name]));
			const loggedOn = new Set(
				existing.flatMap((e) =>
					e.taskId === reviewTask.id && e.projectId ? [e.projectId] : [],
				),
			);

			let room = beforeReviews;
			for (const [pullRequestUrl, events] of byPullRequest) {
				const [first] = events;
				if (!first) continue;
				if (homes.has(pullRequestUrl) || loggedOn.has(first.projectId)) {
					for (const event of events) accountedReviews.add(event.eventId);
					continue;
				}
				// The same reason as the work branch: a suggestion that `apply`
				// would refuse is worse than none.
				if (
					!nameById.has(first.projectId) ||
					!access.canTrackOn(first.projectId)
				) {
					continue;
				}
				const wasDeleted = deleted.has(pullRequestUrl);
				if (wasDeleted) {
					dismissedCount++;
					if (!includeDismissed) continue;
				}
				const durationSeconds = Math.min(
					REVIEW_BLOCK_SECONDS,
					room - (room % QUARTER_HOUR_SECONDS),
				);
				if (durationSeconds <= 0) continue;
				room -= durationSeconds;
				reviewSeconds += durationSeconds;
				for (const event of events) accountedReviews.add(event.eventId);
				suggestions.push({
					key: `review:${pullRequestUrl}`,
					kind: "review",
					taskId: reviewTask.id,
					taskName: reviewTask.name,
					projectId: first.projectId,
					projectName: nameById.get(first.projectId) ?? null,
					description: reviewBlockDescription(first.title),
					durationSeconds,
					fillsDay: false,
					meetingUrl: null,
					calendarEventId: null,
					commits: [],
					pullRequests: [
						{
							projectGithubRepoId: first.projectGithubRepoId,
							number: first.number,
							title: first.title,
							repoFullName: first.repoFullName,
							kinds: events.map((event) => event.kind),
						},
					],
					dismissed: wasDeleted,
				});
			}
		}

		const remaining = remainingSeconds(beforeReviews, reviewSeconds);

		// ── Work: one entry per project with commits or PR activity that day ────
		let workSeconds = 0;
		const evidenceByProject = new Map<string, ProjectEvidence>();
		const evidenceFor = (projectId: string): ProjectEvidence => {
			const existing = evidenceByProject.get(projectId);
			if (existing) return existing;
			const created: ProjectEvidence = { commits: [], pullRequests: [] };
			evidenceByProject.set(projectId, created);
			return created;
		};
		for (const commit of commits) {
			evidenceFor(commit.projectId).commits.push(commit);
		}
		// One row per PR, not per event: the dialog and the attach both name a PR.
		for (const event of pullRequestEvents) {
			if (accountedReviews.has(event.eventId)) continue;
			const { pullRequests } = evidenceFor(event.projectId);
			const existing = pullRequests.find(
				(pr) =>
					pr.projectGithubRepoId === event.projectGithubRepoId &&
					pr.number === event.number,
			);
			if (existing) existing.kinds.push(event.kind);
			else {
				pullRequests.push({
					projectGithubRepoId: event.projectGithubRepoId,
					number: event.number,
					title: event.title,
					repoFullName: event.repoFullName,
					kinds: [event.kind],
				});
			}
		}

		// A day that already has a fill block is already claiming the rest of its
		// working hours — usually the commit-sync engine's own block, built from
		// these very commits. Proposing project work on top of it produces a second
		// Development entry that starves the fill down to 0 seconds, leaving an
		// empty block sitting next to the real one. The fill wins: it's the entry
		// the person can already see.
		const hasFillBlock = existing.some((e) => e.fillsDay);

		if (
			evidenceByProject.size > 0 &&
			workTask &&
			!hasFillBlock &&
			remaining >= QUARTER_HOUR_SECONDS
		) {
			const projectIds = [...evidenceByProject.keys()];
			const [access, projects] = await Promise.all([
				// `listUserCommitsForDay` scans EVERY repo linked anywhere in the org,
				// so a commit to a repo whose project you are not on is routine rather
				// than exotic. Without this the assembler proposed work on it, arriving
				// pre-ticked, and `apply` — which routes through `create` and does
				// assert access — returned `{ created: 0, errors: ["You are not
				// assigned to this project"] }`. A suggestion that cannot be accepted
				// is worse than no suggestion.
				ctxAccess(ctx),
				db.query.project.findMany({
					where: and(
						eq(project.organizationId, ctx.organizationId),
						inArray(project.id, projectIds),
					),
					columns: { id: true, name: true },
				}),
			]);
			const nameById = new Map(projects.map((p) => [p.id, p.name]));

			const groups = projectIds
				.filter((id) => nameById.has(id) && access.canTrackOn(id))
				.map((id) => ({ projectId: id, ...evidenceFor(id) }));

			// A pull request somebody opened, merged or reviewed weighs what one
			// commit does. Neither measures time; the split only needs a ratio
			// that leaves a review-only project with a share rather than none.
			const shares = splitProportionally(
				remaining,
				groups.map((g) => g.commits.length + g.pullRequests.length),
			);

			groups.forEach((group, index) => {
				const share = shares[index] ?? 0;
				if (share <= 0) return;
				workSeconds += share;
				suggestions.push({
					key: `work:${group.projectId}`,
					kind: "work",
					taskId: workTask.id,
					taskName: workTask.name,
					projectId: group.projectId,
					projectName: nameById.get(group.projectId) ?? null,
					description: summarizeCommitMessages([
						...group.commits.map((c) => c.message),
						...describePullRequestActivity(
							group.pullRequests.flatMap((pr) =>
								pr.kinds.map((kind) => ({
									kind,
									number: pr.number,
									title: pr.title,
								})),
							),
						),
					]),
					durationSeconds: share,
					fillsDay: false,
					meetingUrl: null,
					calendarEventId: null,
					// Per-project commit work is derived fresh from the commits every
					// time; there is no record of one having been deleted, so there is
					// nothing here for the toggle to hold back.
					dismissed: false,
					commits: group.commits.map((c) => ({
						projectGithubRepoId: c.projectGithubRepoId,
						sha: c.sha,
						message: c.message,
						repoFullName: c.repoFullName,
					})),
					pullRequests: group.pullRequests,
				});
			});
		}

		// ── Fill: whatever the signals above did not account for ────────────────
		//
		// Without this the assembler could only ever propose what it had evidence
		// for, so a person with no calendar and no commits — the common case on a
		// heads-down day — was offered a 30-minute break against an 8-hour target
		// and told the day "already matches your working hours". The break is
		// carved out of the day, so on its own it never adds up to one.
		//
		// It is deliberately last and deliberately un-sized on apply: `create`
		// derives a fill block's duration from what the day has left, so
		// deselecting a meeting above grows this to match instead of leaving a
		// hole. The number here is the estimate that pairs with the dialog's "~".
		const unaccounted = remainingSeconds(remaining, workSeconds);
		if (workTask && !hasFillBlock && unaccounted >= QUARTER_HOUR_SECONDS) {
			// A day whose rest-of-day block the person deleted. The commit engine
			// honours that tombstone and so does this — the assembler proposing the
			// very thing the engine has been told not to rebuild is the same block
			// coming back, just with an extra click in front of it.
			const deletedFill = await db.query.commitFillTombstone.findFirst({
				where: and(
					eq(commitFillTombstone.organizationId, ctx.organizationId),
					eq(commitFillTombstone.userId, ctx.userId),
					eq(commitFillTombstone.date, date),
				),
				columns: { id: true },
			});
			if (deletedFill) dismissedCount++;

			if (!deletedFill || includeDismissed) {
				suggestions.push({
					key: "fill",
					kind: "fill",
					taskId: workTask.id,
					taskName: workTask.name,
					projectId: null,
					projectName: null,
					description: "Rest of day",
					durationSeconds: unaccounted,
					fillsDay: true,
					meetingUrl: null,
					calendarEventId: null,
					commits: [],
					pullRequests: [],
					dismissed: !!deletedFill,
				});
			}
		}

		return {
			date,
			targetSeconds,
			loggedSeconds: logged,
			suggestions,
			sources: {
				calendar:
					calendarLinked && calendarEvents !== null ? "ok" : "unavailable",
				github: githubLinked ? "ok" : "unavailable",
			},
			dismissedCount,
		};
	},

	/** Create the accepted suggestions through timeEntriesService.create, so every
	 *  invariant (taxonomy gate, fill uniqueness, fill recompute, sync-lock on
	 *  calendar-linked rows) holds exactly as if entered by hand.
	 *  Best-effort per entry: one failure doesn't abort the rest. */
	apply: async (ctx: Ctx, input: ApplyDayAssemblyInput) => {
		// The 24-hour ceiling for the whole proposal, before any of it is written.
		// `create` checks each entry as well, but this loop is best-effort per
		// entry, so on its own a proposal that did not fit wrote its first few
		// entries and refused the rest — half of what the person accepted, which
		// is a day nobody asked for. Reported like any other failure here rather
		// than thrown, so the caller's shape stays the same.
		//
		// A fill block is exempt, as it is in `create`: it is sized from what is
		// left, whatever duration the client sent. An entry that attaches a
		// calendar event takes the place of that event's synced row (see
		// `create`), so that row does not count against it.
		const worked = input.entries.filter((entry) => !entry.fillsDay);
		const replacedEvents = new Set(
			worked.flatMap((entry) =>
				entry.calendarEventId ? [entry.calendarEventId] : [],
			),
		);
		try {
			await assertDayHasRoom(
				ctx,
				input.date,
				worked.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0),
				{
					replacing: (row) =>
						row.calendarEventId != null &&
						replacedEvents.has(row.calendarEventId),
				},
			);
		} catch (error) {
			if (!(error instanceof DayCapacityError)) throw error;
			return { created: 0, errors: [error.message] };
		}

		// Fill blocks last — their derived duration must see the siblings first.
		const ordered = [...input.entries].sort(
			(a, b) => Number(a.fillsDay ?? false) - Number(b.fillsDay ?? false),
		);

		let created = 0;
		const errors: string[] = [];
		for (const entry of ordered) {
			try {
				const row = await timeEntriesService.create(ctx, {
					taskId: entry.taskId,
					projectId: entry.projectId,
					description: entry.description,
					date: input.date,
					durationSeconds: entry.durationSeconds,
					overtime: entry.overtime ?? false,
					fillsDay: entry.fillsDay ?? false,
					meetingUrl: entry.meetingUrl,
					calendarEventId: entry.calendarEventId,
				});
				created += 1;
				if (entry.commits && entry.commits.length > 0) {
					// Evidence attachment is decoration — never fail the entry over it.
					await githubService
						.attachCommits(ctx, {
							timeEntryId: row.id,
							commits: entry.commits,
						})
						.catch((error) =>
							console.error("[day-assembly] attachCommits failed", error),
						);
				}
				if (entry.pullRequests && entry.pullRequests.length > 0) {
					await githubService
						.attachPullRequests(ctx, {
							timeEntryId: row.id,
							pullRequests: entry.pullRequests,
						})
						.catch((error) =>
							console.error("[day-assembly] attachPullRequests failed", error),
						);
				}
			} catch (error) {
				errors.push(
					error instanceof Error ? error.message : "Failed to create entry",
				);
			}
		}
		return { created, errors };
	},
};
