import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { account } from "../db/schema/auth";
import {
	project,
	projectTask,
	type TaskSystemKey,
	timeEntry,
} from "../db/schema/domain";
import { syncedMeetingTombstone } from "../db/schema/settings";
import { orgTimezone } from "../lib/org-time";
import {
	QUARTER_HOUR_SECONDS,
	snapToQuarterHour,
	weekdayInTz,
} from "../lib/time";
import type {
	ApplyDayAssemblyInput,
	SuggestDayAssemblyInput,
} from "../schema/day-assembly";
import { githubService } from "./github.service";
import { googleCalendarService } from "./google-calendar.service";
import { recurringBlockRulesService } from "./recurring-block-rules.service";
import { tasksService } from "./tasks.service";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";
import {
	dayDurationSeconds,
	workingHoursService,
} from "./working-hours.service";

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

export type DaySuggestion = {
	/** Stable client-side key: "meeting:<eventId>" | "work:<projectId>" | "break" | "fill". */
	key: string;
	kind: "meeting" | "work" | "break" | "fill";
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
};

const hasLinkedAccount = async (userId: string, providerId: string) => {
	const row = await db.query.account.findFirst({
		where: and(eq(account.userId, userId), eq(account.providerId, providerId)),
		columns: { id: true },
	});
	return !!row;
};

/** Split `total` across weights, snapped to the 15-minute grid, so the parts
 *  sum to no more than the total. */
const splitProportionally = (total: number, weights: number[]): number[] => {
	const sum = weights.reduce((a, b) => a + b, 0);
	if (sum <= 0) return weights.map(() => 0);
	let remaining = total;
	return weights.map((weight, index) => {
		if (index === weights.length - 1) {
			return Math.max(
				0,
				Math.floor(remaining / QUARTER_HOUR_SECONDS) * QUARTER_HOUR_SECONDS,
			);
		}
		const share =
			Math.floor((total * weight) / sum / QUARTER_HOUR_SECONDS) *
			QUARTER_HOUR_SECONDS;
		remaining -= share;
		return share;
	});
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
	/** Read-only preview. Nothing is written except the recurring materializer,
	 *  which every time-page read already runs. */
	suggest: async (
		ctx: Ctx,
		input: SuggestDayAssemblyInput,
	): Promise<DayAssembly> => {
		const { date } = input;
		await recurringBlockRulesService.materializeRange(ctx, date, date);

		const tz = await orgTimezone(ctx.organizationId);

		const [
			existing,
			workingHours,
			meetingTask,
			workTask,
			breakTask,
			calendarEvents,
			commits,
			calendarLinked,
			githubLinked,
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
				},
			}),
			workingHoursService.list(ctx),
			findEngineTask(ctx, "meeting"),
			findEngineTask(ctx, "development"),
			findEngineTask(ctx, "break"),
			googleCalendarService
				.listEventsForRange(ctx, { from: date, to: date })
				.catch((error) => {
					console.error("[day-assembly] calendar read failed", error);
					return null;
				}),
			githubService.listUserCommitsForDay(ctx, date).catch((error) => {
				console.error("[day-assembly] commit read failed", error);
				return [];
			}),
			// "google-calendar", not "google": the plain Google provider is only a
			// sign-in link and carries no calendar scope, so checking it reported
			// "connect your calendar" at people who had already connected it.
			hasLinkedAccount(ctx.userId, "google-calendar"),
			hasLinkedAccount(ctx.userId, "github"),
		]);

		const weekday = weekdayInTz(date, tz);
		const day = workingHours.find((d) => d.dayOfWeek === weekday);
		const targetSeconds = day ? dayDurationSeconds(day) : 0;

		const loggedSeconds = existing.reduce(
			(sum, e) => sum + e.durationSeconds,
			0,
		);
		// Fill blocks don't consume the remaining budget: their duration is derived
		// and re-shrinks as siblings appear.
		const spokenFor = existing
			.filter((e) => !e.fillsDay)
			.reduce((sum, e) => sum + e.durationSeconds, 0);

		const suggestions: DaySuggestion[] = [];

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
			const skipIds = new Set(tombstones.map((t) => t.calendarEventId));
			for (const e of existing) {
				if (e.calendarEventId) skipIds.add(e.calendarEventId);
			}

			for (const event of calendarEvents) {
				if (skipIds.has(event.id)) continue;
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
				});
			}
		}

		// ── Break: carved out of the day, not added on top ──────────────────────
		let breakSeconds = 0;
		const preBreakRemaining = Math.max(
			0,
			targetSeconds - spokenFor - meetingSeconds,
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
			});
		}

		const remainingSeconds = Math.max(0, preBreakRemaining - breakSeconds);

		// ── Work: one entry per project the user committed to that day ──────────
		const commitsByProject = new Map<string, typeof commits>();
		for (const commit of commits) {
			const list = commitsByProject.get(commit.projectId) ?? [];
			list.push(commit);
			commitsByProject.set(commit.projectId, list);
		}

		// A day that already has a fill block is already claiming the rest of its
		// working hours — usually the commit-sync engine's own block, built from
		// these very commits. Proposing project work on top of it produces a second
		// Development entry that starves the fill down to 0 seconds, leaving an
		// empty block sitting next to the real one. The fill wins: it's the entry
		// the person can already see.
		const hasFillBlock = existing.some((e) => e.fillsDay);

		if (
			commitsByProject.size > 0 &&
			workTask &&
			!hasFillBlock &&
			remainingSeconds >= QUARTER_HOUR_SECONDS
		) {
			const projectIds = [...commitsByProject.keys()];
			const [projects, picked] = await Promise.all([
				db.query.project.findMany({
					where: and(
						eq(project.organizationId, ctx.organizationId),
						inArray(project.id, projectIds),
					),
					columns: { id: true, name: true },
				}),
				// Only propose the work task on projects that have actually picked it —
				// the same taxonomy gate a hand-made entry passes.
				db
					.select({ projectId: projectTask.projectId })
					.from(projectTask)
					.where(
						and(
							eq(projectTask.organizationId, ctx.organizationId),
							eq(projectTask.taskId, workTask.id),
							inArray(projectTask.projectId, projectIds),
						),
					),
			]);
			const nameById = new Map(projects.map((p) => [p.id, p.name]));
			const pickedIds = new Set(picked.map((p) => p.projectId));

			const groups = projectIds
				.filter((id) => nameById.has(id) && pickedIds.has(id))
				.map((id) => ({
					projectId: id,
					commits: commitsByProject.get(id) ?? [],
				}));

			const shares = splitProportionally(
				remainingSeconds,
				groups.map((g) => g.commits.length),
			);

			groups.forEach((group, index) => {
				const share = shares[index] ?? 0;
				if (share <= 0) return;
				suggestions.push({
					key: `work:${group.projectId}`,
					kind: "work",
					taskId: workTask.id,
					taskName: workTask.name,
					projectId: group.projectId,
					projectName: nameById.get(group.projectId) ?? null,
					// Mandatory descriptions mean the assembler has to propose one; the
					// commit subjects are the best raw material available, and the person
					// edits before accepting.
					description: group.commits
						.slice(0, 3)
						.map((c) => c.message.split("\n")[0])
						.join("; "),
					durationSeconds: share,
					fillsDay: false,
					meetingUrl: null,
					calendarEventId: null,
					commits: group.commits.map((c) => ({
						projectGithubRepoId: c.projectGithubRepoId,
						sha: c.sha,
						message: c.message,
						repoFullName: c.repoFullName,
					})),
				});
			});
		}

		return {
			date,
			targetSeconds,
			loggedSeconds,
			suggestions,
			sources: {
				calendar:
					calendarLinked && calendarEvents !== null ? "ok" : "unavailable",
				github: githubLinked ? "ok" : "unavailable",
			},
		};
	},

	/** Create the accepted suggestions through timeEntriesService.create, so every
	 *  invariant (taxonomy gate, fill uniqueness, fill recompute, sync-lock on
	 *  calendar-linked rows) holds exactly as if entered by hand.
	 *  Best-effort per entry: one failure doesn't abort the rest. */
	apply: async (ctx: Ctx, input: ApplyDayAssemblyInput) => {
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
			} catch (error) {
				errors.push(
					error instanceof Error ? error.message : "Failed to create entry",
				);
			}
		}
		return { created, errors };
	},
};
