import {
	and,
	asc,
	count,
	countDistinct,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lte,
	notInArray,
	sql,
} from "drizzle-orm";
import postgres from "postgres";

import { db } from "../db";
import {
	projectMember,
	recurringBlockRuleSkip,
	task,
	timeEntry,
} from "../db/schema/domain";
import {
	timeEntryGithubCommit,
	timeEntryGithubPrActivity,
} from "../db/schema/github";
import {
	commitFillTombstone,
	syncedMeetingTombstone,
} from "../db/schema/settings";
import {
	automationWriteWindow,
	enabledSinceKey,
} from "../lib/automation-window";
import { summarizeCommitMessages } from "../lib/day-plan";
import { describePullRequestActivity } from "../lib/github-activity";
import {
	addDaysToKey,
	datesBetween,
	dayKeyInTz,
	monthBounds,
	snapToQuarterHour,
} from "../lib/time";
import {
	MAX_DAY_SECONDS,
	remainingSeconds,
	spokenForSeconds,
	targetSecondsFor,
} from "../lib/working-day";
import type {
	AbsenceTotalsInput,
	CopyTimeEntriesInput,
	CopyWeekEntriesInput,
	CreateAbsenceForUserInput,
	CreateTimeEntryInput,
	FileTimeEntriesInput,
	FileTimeEntryInput,
	ListAbsenceForUserInput,
	LogAbsenceRangeInput,
	OverrideAbsenceEntryInput,
	SetTimeEntryOvertimeInput,
	SetWeekCellInput,
	UpdateTimeEntryDescriptionInput,
	UpdateTimeEntryInput,
} from "../schema/time-entries";
import { AccessError } from "./access.service";
import { ctxAccess, ctxDb, ctxTimezone, withCtxTx } from "./context";
import {
	computeDayFillSeconds,
	recomputeDayFill,
	rehomeDroppedFillEvidence,
} from "./day-fill";
import { filingRuleKey, filingRulesService } from "./filing-rules.service";
import {
	pullRequestActivityRow,
	type ScannedCommit,
	type ScannedPullRequestActivity,
} from "./github.service";
import {
	assertProjectInOrg,
	assertDescribed,
	assertTaskAvailable,
	assertUserInOrg,
} from "./guards";
import { holidaysService } from "./holidays.service";
import { WORKING_DAY_SECONDS } from "./hour-fund.service";
import { integrationSettingsService } from "./integration-settings.service";
import { ledgerWhere } from "./ledger";
import { orgSettingsService } from "./org-settings.service";
import { calendarSource, commitSource, pullRequestSource } from "./ports";
import { recurringBlockRulesService } from "./recurring-block-rules.service";
import { tasksService } from "./tasks.service";
import { CTX_MEMO, type Ctx, type CtxMemo } from "./types";
import { workingHoursService } from "./working-hours.service";

/**
 * A hand-made write refused because it would push a day past 24 hours.
 *
 * A type rather than a bare `Error` so `copyWeek` can catch THIS and nothing
 * else. Its loop used to swallow everything and report the day as "blocked",
 * which is the right answer for a day that is genuinely too full and a wrong,
 * silent one for a database failure — reported to the person as though their
 * data were the problem.
 *
 * The message goes to a toast as it stands, so it is written for the person and
 * names no particular action: copying, typing into a cell and saving the entry
 * dialog all end up here.
 */
export class DayCapacityError extends Error {
	constructor(readonly dateKey: string) {
		super(`This would put more than 24 hours on ${dateKey}`);
		this.name = "DayCapacityError";
	}
}

// ── Integration sync engines ───────────────────────────────────────────────
// These used to run inside listRange, so the act of opening the time page — or
// scrolling it — was what imported external state. That made a READ do writes
// whose extent depended on which screen the person happened to be looking at,
// which is how three engines ended up filing entries across months of
// already-filed timesheets.
//
// They are scheduled jobs now (packages/core/src/jobs/automation-sync.ts),
// driven by the worker, over the window in lib/automation-window. This host is
// a long-lived Bun process, not a serverless function, so there is no reason
// for a page load to be the trigger.
//
// Each is still best-effort and idempotent: a failure logs and the next tick
// retries.

// How a person recognises "the same meeting" when the calendar event id behind
// it has changed: it's on the same day and either reads the same and runs the
// same length, or points at the same join link. Both keys are deliberately
// day-scoped — a weekly stand-up shares its title, length AND Meet link across
// every occurrence, so a key without the date would collapse the whole series.
const meetingIdentityKeys = (row: {
	date: string;
	description: string;
	durationSeconds: number;
	meetingUrl: string | null;
}): string[] => {
	const keys = [
		`t|${row.date}|${row.description.trim().toLowerCase()}|${row.durationSeconds}`,
	];
	if (row.meetingUrl) keys.push(`u|${row.date}|${row.meetingUrl}`);
	return keys;
};

// Reconcile a range against Google Calendar so the user's meeting entries mirror
// their calendar. Google is the source of truth ONLY for sync-owned rows
// (syncLocked = false). Tombstones keep a user-deleted meeting from returning.
//
// Under the duration-only entry model a meeting contributes its LENGTH, not its
// slot — an event's start/end are read purely to derive a duration, which is
// then snapped to the 15-minute grid every entry must sit on.
//
// `range` is the window the caller has already decided this engine may touch —
// see lib/automation-window, and note that the delete-by-absence pass at the
// bottom reads the same `range`, so narrowing the window narrows what can be
// un-written as well as what can be written.
const syncMeetingsForRange = async (
	ctx: Ctx,
	range: { from: string; to: string },
	tz: string,
) => {
	const events = await calendarSource().listEventsForRange(ctx, range);
	// null => couldn't read the calendar (disconnected / revoked token). Bail
	// without deleting, or we'd wipe synced entries we merely failed to fetch.
	if (events === null) return;

	// Resolved by system key, not by name: "Meeting" is a site built-in that an
	// org may have relabelled, and the old name match meant a relabel silently
	// switched this whole engine off.
	const meetingTask = await tasksService.findBySystemKey(ctx, "meeting");
	if (!meetingTask) return;

	// Standing "always file this one to that project" answers, keyed on the
	// normalized title. Resolved once for the whole range rather than per event,
	// and already filtered to projects the person may still write to — see
	// filingRulesService.resolveForTask.
	const filingRules = await filingRulesService.resolveForTask(
		ctx,
		meetingTask.id,
	);

	const tombstones = await db.query.syncedMeetingTombstone.findMany({
		where: and(
			eq(syncedMeetingTombstone.organizationId, ctx.organizationId),
			eq(syncedMeetingTombstone.userId, ctx.userId),
		),
		columns: { calendarEventId: true },
	});
	const tombstoned = new Set(tombstones.map((t) => t.calendarEventId));

	// Duplicate guard for REISSUED event ids. Google mints new instance ids when a
	// recurring series is edited with "this and following", and a cancelled-and-
	// recreated meeting is a new event outright. Delete-by-absence below would
	// retire the old block — except it deliberately spares sync-locked rows, and
	// every meeting the person has filed against a project is sync-locked. So the
	// new id imports next to the old one and the day shows the same meeting twice.
	//
	// Match on what a person actually sees rather than on ids: same day + same
	// title + same length, or same day + same join link.
	const lockedRows = await db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ctx.organizationId),
			eq(timeEntry.userId, ctx.userId),
			eq(timeEntry.syncLocked, true),
			isNotNull(timeEntry.calendarEventId),
			gte(timeEntry.date, range.from),
			lte(timeEntry.date, range.to),
		),
		columns: {
			calendarEventId: true,
			date: true,
			description: true,
			durationSeconds: true,
			meetingUrl: true,
		},
	});
	// key -> the event id already holding that slot, so an event never shadows
	// its own entry (the ordinary case: the row IS this event, already locked).
	const lockedBy = new Map<string, string>();
	for (const row of lockedRows) {
		if (!row.calendarEventId) continue;
		for (const key of meetingIdentityKeys(row)) {
			lockedBy.set(key, row.calendarEventId);
		}
	}

	const rows = events
		.filter((event) => !tombstoned.has(event.id))
		.map((event) => {
			const startedAt = new Date(event.start);
			const stoppedAt = new Date(event.end);
			return {
				event,
				startedAt,
				rawSeconds: Math.floor(
					(stoppedAt.getTime() - startedAt.getTime()) / 1000,
				),
			};
		})
		// On the RAW duration, before the snap. `snapToQuarterHour` floors at 15
		// minutes on purpose, so a 3-minute meeting is still a real block — which
		// also means it turns a zero-length event (and an inverted one) into a
		// 15-minute block rather than dropping it. The `durationSeconds > 0` filter
		// that used to sit below the snap could therefore never be false. The day
		// assembler has always checked `raw <= 0`; this is the engine that writes.
		.filter(({ rawSeconds }) => rawSeconds > 0)
		.map(({ event, startedAt, rawSeconds }) => {
			return {
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				taskId: meetingTask.id,
				// A synced meeting has no project by default: it's the user's job to
				// file it against one, and it lands as a project-less draft they can
				// complete. A filing rule is the person having already answered that
				// question for this meeting, so the occurrence arrives filed.
				//
				// The row stays syncLocked = false either way. The rule decides where
				// the time goes, not who owns the row: Google is still the source of
				// truth for its title, length and existence, so a cancelled meeting
				// still disappears and a renamed one still updates. Taking ownership
				// is what filing BY HAND means (see `file`), and that is a different
				// act from having pre-answered where it goes.
				projectId: filingRules.get(filingRuleKey(event.title)) ?? null,
				description: event.title,
				date: dayKeyInTz(startedAt, tz),
				durationSeconds: snapToQuarterHour(rawSeconds),
				meetingUrl: event.meetingUrl,
				calendarEventId: event.id,
			};
		})
		// Only days this engine may write to. `range` is the automation window, and
		// Google's `timeMin` matches on overlap, not on start: an event that began
		// the evening before `range.from` comes back too, dated by its start — a
		// day the lock or the grace window has already closed.
		.filter((row) => row.date >= range.from && row.date <= range.to)
		.filter((row) => {
			const holder = meetingIdentityKeys(row)
				.map((key) => lockedBy.get(key))
				.find((eventId) => eventId != null);
			if (holder == null || holder === row.calendarEventId) return true;
			console.info("[time-entries] skipping reissued calendar event", {
				keptEventId: holder,
				skippedEventId: row.calendarEventId,
				date: row.date,
			});
			return false;
		});

	// Days whose fill block may now be the wrong length. Collected rather than
	// derived at the end, because by then the moves have already happened and the
	// day a meeting LEFT is no longer nameable from anything in hand.
	const touched = new Set<string>();

	if (rows.length > 0) {
		// Where these events sit BEFORE the upsert moves them. A meeting dragged
		// from Monday to Tuesday gives Monday its quarter-hour back, and the block
		// that has to absorb it is on the day the meeting is leaving — a date every
		// other collection point below has already overwritten.
		const previous = await db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				eq(timeEntry.syncLocked, false),
				inArray(
					timeEntry.calendarEventId,
					rows.map((row) => row.calendarEventId),
				),
				// Only rows the upsert below may move. One sitting on a closed day stays
				// where it is, so its day loses nothing and must not be recomputed.
				gte(timeEntry.date, range.from),
				lte(timeEntry.date, range.to),
			),
			columns: { date: true },
		});
		for (const row of previous) touched.add(row.date);

		const written = await db
			.insert(timeEntry)
			.values(rows)
			.onConflictDoUpdate({
				target: [
					timeEntry.organizationId,
					timeEntry.userId,
					timeEntry.calendarEventId,
				],
				targetWhere: sql`${timeEntry.calendarEventId} is not null`,
				set: {
					description: sql`excluded.description`,
					date: sql`excluded.date`,
					durationSeconds: sql`excluded.duration_seconds`,
					meetingUrl: sql`excluded.meeting_url`,
				},
				// The existing row's date, not the incoming one: a meeting already
				// synced onto a locked or out-of-window day is history, and moving it
				// out is a write to that day as surely as adding to it. Without this, a
				// stand-up on the 28th that was moved to the 2nd left August, and the
				// fill recompute then grew August's rest-of-day block back by its
				// length — hours added to a month already closed.
				setWhere: and(
					eq(timeEntry.syncLocked, false),
					gte(timeEntry.date, range.from),
					lte(timeEntry.date, range.to),
				),
			})
			// What actually landed. A conflict the `setWhere` declined returns
			// nothing, so its day is not touched either.
			.returning({ date: timeEntry.date });
		for (const row of written) touched.add(row.date);
	}

	// Delete-by-absence. An EMPTY live set is deliberately treated like `null`
	// (skip deletion): Google can return an empty page on a throttled request or
	// a partial scope, and wiping every synced entry on a false empty is
	// unrecoverable, whereas skipping just leaves a stale row until next sync.
	const liveIds = events.map((event) => event.id);
	if (liveIds.length > 0) {
		const removed = await db
			.delete(timeEntry)
			.where(
				and(
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
					eq(timeEntry.syncLocked, false),
					isNotNull(timeEntry.calendarEventId),
					gte(timeEntry.date, range.from),
					lte(timeEntry.date, range.to),
					notInArray(timeEntry.calendarEventId, liveIds),
				),
			)
			.returning({ date: timeEntry.date });
		for (const row of removed) touched.add(row.date);
	}

	// A meeting is a claim on the day, so the day's fill block — which describes
	// "the rest of the working day" — is one meeting shorter than it was. Nothing
	// else was resizing it: the commit engine guards its own insert with
	// `onConflictDoNothing` and so never revisits a block it already wrote, and
	// `listRange`'s read-path recompute only reaches back AUTOMATION_GRACE_DAYS.
	// A meeting that synced after the block existed therefore left the day
	// over-allocated for good — an 8h block plus a 0:15 stand-up against an 8h
	// day, which then reported as 8:45. `materializeRange` in
	// recurring-block-rules already ends this way, for exactly the same reason;
	// this engine was the one write path that did not.
	//
	// Unwindowed, like every other `recomputeDayFill` call, and safe because every
	// date here came out of `range` — which the caller has already narrowed to
	// what this automation may write to.
	//
	// Best-effort and outside the writes above: failing to resize a fill block
	// must not cost the person the meetings that were just imported.
	for (const date of touched) {
		try {
			await recomputeDayFill(ctx, date, tz);
		} catch (error) {
			console.error("[meetings] fill recompute failed", { date, error });
		}
	}
};

// For every day the user pushed commits: attach those commits to the work entry
// that already describes the day, and — only if nothing does — file a "rest of
// day" fill block so tracked time expands to that day's working hours.
//
// Two things this engine gets asked to do, and they are not the same thing:
//
//   1. ATTACH the commits. They are evidence: they name the block and let the
//      entry answer "what was this?" without the person retyping it. This is
//      almost free and is worth doing whenever there is anything to attach to.
//   2. CREATE a block, when the day would otherwise go unaccounted for.
//
// They used to be welded together — the engine only ever wrote its own fill
// block and only ever attached to that. So a person who had already logged their
// day properly (a real Development entry per project, from Assemble my day or by
// hand) got their commits attached to NOTHING: `computeDayFillSeconds` returned
// <= 0 for a full day, the loop hit `continue`, and the evidence was dropped on
// the floor. The commonest, best-behaved case was the one that lost data.
//
// So: resolve a target per project first (below), attach there, and treat the
// fill block as the fallback it always was rather than the point.
//
// `range` is the window the caller has already decided this engine may touch —
// see lib/automation-window, and note that this engine asks for
// `completeDaysOnly`, because the block it writes is sized from the day's WHOLE
// target and that number is only true once the day is over.
/**
 * Which project, if any, the day's rest-of-day block should be filed against.
 *
 * Only when EVERY commit that found no home belongs to the same project. A repo
 * is linked to exactly one project org-wide (pgr_org_repo_unq), so one project
 * across the day's homeless commits means there is no guess to make: the block
 * describes work on that project and nothing else. Two projects and it stays
 * null — the block is sized from the whole remaining day, so splitting it would
 * be inventing a ratio the commits do not contain, and filing all of it to
 * either project bills that project for the other one's hours.
 *
 * Note this deliberately does NOT read the commits' volume or timestamps. The
 * block never claimed to measure the commits; it claims the rest of the working
 * day, and the commits are the evidence that the day was spent on that project.
 *
 * Both gates fall back to null rather than throwing. This runs inside a
 * background sweep over everybody, and a project that hasn't picked Development
 * is a configuration answer, not a failure — the old project-less block is
 * still the correct, if less helpful, thing to write.
 */
const resolveFillProject = async (
	ctx: Ctx,
	homelessProjectIds: string[],
): Promise<string | null> => {
	const [projectId] = homelessProjectIds;
	if (!projectId || homelessProjectIds.length !== 1) return null;

	// Belt and braces: `reposForUser` already inner-joins an active projectMember
	// row, so a commit cannot reach here on a project the person isn't on. Kept
	// because this writes billable project time and that invariant lives three
	// files away — the memo makes it free.
	const access = await ctxAccess(ctx);
	if (!access.canTrackOn(projectId)) return null;

	// The project must actually offer Development. `development` is org-scoped,
	// not one of the universal site-scoped built-ins, so this is a real
	// cherry-pick check — and writing an entry the person could not have created
	// by hand is exactly what assertTaskAvailable exists to prevent.
	const workTask = await tasksService.findBySystemKey(ctx, "development");
	if (!workTask) return null;
	try {
		await assertTaskAvailable(ctx, workTask.id, projectId);
	} catch {
		return null;
	}
	return projectId;
};

/** What GitHub says happened on one day, or on one project that day: what was
 *  pushed, and what happened on pull requests. The engine treats both the same
 *  way — evidence to attach, and a reason to file the rest of the day. */
type DayEvidence = {
	commits: ScannedCommit[];
	pullRequests: ScannedPullRequestActivity[];
};

const emptyEvidence = (): DayEvidence => ({ commits: [], pullRequests: [] });

const mergeEvidence = (groups: DayEvidence[]): DayEvidence => ({
	commits: groups.flatMap((g) => g.commits),
	pullRequests: groups.flatMap((g) => g.pullRequests),
});

/** A description written from the evidence: commit subjects first, since they
 *  say what changed, then the pull request events. */
const describeEvidence = (evidence: DayEvidence): string =>
	summarizeCommitMessages([
		...evidence.commits.map((c) => c.message),
		...describePullRequestActivity(evidence.pullRequests),
	]);

const syncCommitWorkTimeForRange = async (
	ctx: Ctx,
	range: { from: string; to: string },
	tz: string,
) => {
	// Commits and pull request events are one body of evidence, read together:
	// a rate limit on either fails the pass, because half the evidence read as
	// all of it would file a day on what was missing.
	const [commitDays, pullRequestDays] = await Promise.all([
		commitSource().listUserCommitsByDay(ctx, range),
		pullRequestSource().listUserPullRequestActivityByDay(ctx, range),
	]);
	const days = new Map<string, DayEvidence>();
	for (const { dayKey, commits } of commitDays) {
		days.set(dayKey, { commits, pullRequests: [] });
	}
	for (const { dayKey, activity } of pullRequestDays) {
		const day = days.get(dayKey) ?? emptyEvidence();
		day.pullRequests.push(...activity);
		days.set(dayKey, day);
	}
	if (days.size === 0) return;

	// Resolved by system key, not by display name. The old lookup matched
	// `name = 'Development'` scoped to the org, so an org that renamed the task
	// (or one seeded before the key existed) had this engine silently switched
	// off — no block, no error.
	const workTask = await tasksService.findBySystemKey(ctx, "development");
	if (!workTask) return;

	const [workingHours, holidays] = await Promise.all([
		workingHoursService.list(ctx),
		// Once for the range, not once per day. A holiday is a zero-target day, so
		// this is what stops a commit pushed on Epiphany from producing a full
		// 8-hour "rest of day" block — the same way a Saturday already produced
		// none, via that day being disabled in the person's working hours.
		holidaysService.holidaySetForRange(ctx, range.from, range.to),
	]);
	for (const [dayKey, { commits, pullRequests }] of days) {
		// GitHub filters `since`/`until` on the COMMITTER date, and the source
		// buckets by AUTHOR date. A rebase rewrites the one and keeps the other, so
		// a branch rebased today returns commits written weeks ago, bucketed on the
		// day they were written — a day the window, the lock, or both have closed.
		// The window is this engine's whole licence to write; a day outside it is
		// dropped, not filed.
		if (dayKey < range.from || dayKey > range.to) continue;
		// Every work entry already on the day, so the loop below can hand each
		// project's commits to the entry that describes that project's work.
		const dayEntries = await db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				eq(timeEntry.date, dayKey),
				eq(timeEntry.taskId, workTask.id),
			),
			columns: {
				id: true,
				description: true,
				projectId: true,
				fillsDay: true,
			},
		});

		// A loop, not `filter().map()`: only this way does the null check actually
		// narrow `projectId` into the key type.
		const byProject = new Map<string, (typeof dayEntries)[number]>();
		for (const entry of dayEntries) {
			if (entry.projectId === null || entry.fillsDay) continue;
			byProject.set(entry.projectId, entry);
		}
		let fill = dayEntries.find((e) => e.fillsDay) ?? null;
		// A project-less Development entry someone logged by hand. Not a fill block,
		// but it is unmistakably "the work I did that day", so commits with no
		// better home belong on it rather than on a new block competing with it.
		const generalEntry =
			dayEntries.find((e) => e.projectId === null && !e.fillsDay) ?? null;

		// Group by project so evidence lands on the entry for the project it
		// belongs to. A project with no entry falls through to the fill.
		const evidenceByProject = new Map<string, DayEvidence>();
		const evidenceFor = (projectId: string): DayEvidence => {
			const existing = evidenceByProject.get(projectId);
			if (existing) return existing;
			const created = emptyEvidence();
			evidenceByProject.set(projectId, created);
			return created;
		};
		for (const commit of commits) {
			evidenceFor(commit.projectId).commits.push(commit);
		}
		for (const event of pullRequests) {
			evidenceFor(event.projectId).pullRequests.push(event);
		}

		const homelessProjectIds = [...evidenceByProject.keys()].filter(
			(projectId) => !byProject.has(projectId),
		);
		const homeless = mergeEvidence(homelessProjectIds.map(evidenceFor));

		// The fill block is created only for evidence that found no home — a day
		// of reviews is a worked day as surely as a day of commits — and only if
		// the day still has room and nobody has said no.
		if (homelessProjectIds.length > 0 && !fill && !generalEntry) {
			const durationSeconds = await computeDayFillSeconds(ctx, dayKey, tz, {
				workingHours,
				holidays,
			});
			const fillProjectId = await resolveFillProject(ctx, homelessProjectIds);
			// A day already accounted for in full gets no block. Inserting a
			// 0-second one would just park an empty second "Development" row next to
			// the entries that already filled the day. Note this no longer skips the
			// day: the attach pass below still runs, which is the fix described
			// above.
			if (durationSeconds > 0 && !(await hasCommitFillTombstone(ctx, dayKey))) {
				const [created] = await db
					.insert(timeEntry)
					.values({
						organizationId: ctx.organizationId,
						userId: ctx.userId,
						taskId: workTask.id,
						projectId: fillProjectId,
						description: describeEvidence(homeless),
						date: dayKey,
						durationSeconds,
						fillsDay: true,
					})
					// te_fill_day_uidx is the real guard against a second fill block on
					// the day; silently skip rather than raise, since this is a
					// best-effort background sync, not a user-initiated write. It also
					// covers the race with a concurrent "Sync now".
					.onConflictDoNothing({
						target: [
							timeEntry.organizationId,
							timeEntry.userId,
							timeEntry.date,
						],
						where: sql`${timeEntry.fillsDay} = true`,
					})
					.returning({
						id: timeEntry.id,
						description: timeEntry.description,
						projectId: timeEntry.projectId,
						fillsDay: timeEntry.fillsDay,
					});

				fill =
					created ??
					// Nothing returned => something else filed the day's fill block
					// between the read above and this insert. Attach to theirs.
					(await db.query.timeEntry.findFirst({
						where: and(
							eq(timeEntry.organizationId, ctx.organizationId),
							eq(timeEntry.userId, ctx.userId),
							eq(timeEntry.date, dayKey),
							eq(timeEntry.fillsDay, true),
						),
						columns: {
							id: true,
							description: true,
							projectId: true,
							fillsDay: true,
						},
					})) ??
					null;
			}
		}

		// Where each project's evidence goes, best home first. Null means the day
		// has nothing to attach to — a full day with no work entry on it — and the
		// evidence is simply left for a later run, once there is.
		const fallback = fill ?? generalEntry;
		const attachments = new Map<string, DayEvidence>();
		for (const [projectId, group] of evidenceByProject) {
			const target = byProject.get(projectId) ?? fallback;
			if (!target) continue;
			attachments.set(
				target.id,
				mergeEvidence([attachments.get(target.id) ?? emptyEvidence(), group]),
			);
		}
		if (attachments.size === 0) continue;

		// Only ever fill a BLANK description. A person's own wording outranks
		// generated commit subjects — and now that this can write to an entry the
		// person made themselves, that rule is doing real work rather than guarding
		// against the engine overwriting its own output.
		const blankDescribable = dayEntries
			.concat(fill && !dayEntries.some((e) => e.id === fill.id) ? [fill] : [])
			.filter((e) => e.description.trim() === "" && attachments.has(e.id));
		for (const entry of blankDescribable) {
			const description = describeEvidence(
				attachments.get(entry.id) ?? emptyEvidence(),
			);
			if (!description) continue;
			await db
				.update(timeEntry)
				.set({ description, updatedAt: new Date() })
				.where(eq(timeEntry.id, entry.id));
		}

		const commitRows = [...attachments].flatMap(([timeEntryId, group]) =>
			group.commits.map((commit) => ({
				timeEntryId,
				projectGithubRepoId: commit.projectGithubRepoId,
				sha: commit.sha,
				message: commit.message,
				authorLogin: commit.authorLogin,
				committedAt: commit.committedAt,
				url: commit.url,
			})),
		);
		if (commitRows.length > 0) {
			await db
				.insert(timeEntryGithubCommit)
				.values(commitRows)
				// tegc_entry_sha_unq: re-running the sync re-attaches the same commits.
				.onConflictDoNothing();
		}
		const activityRows = [...attachments].flatMap(([timeEntryId, group]) =>
			group.pullRequests.map((event) =>
				pullRequestActivityRow(timeEntryId, event.projectGithubRepoId, event),
			),
		);
		if (activityRows.length > 0) {
			await db
				.insert(timeEntryGithubPrActivity)
				.values(activityRows)
				// tegpa_entry_event_unq: the same, for pull request events.
				.onConflictDoNothing();
		}
	}
};

/** Did this person delete the day's rest-of-day block? See the table comment in
 *  db/schema/settings.ts — the engine's way of being told no. */
const hasCommitFillTombstone = async (ctx: Ctx, dateKey: string) => {
	const row = await db.query.commitFillTombstone.findFirst({
		where: and(
			eq(commitFillTombstone.organizationId, ctx.organizationId),
			eq(commitFillTombstone.userId, ctx.userId),
			eq(commitFillTombstone.date, dateKey),
		),
		columns: { id: true },
	});
	return !!row;
};

/**
 * Refuse a hand-made write that would put more than `MAX_DAY_SECONDS` on a day.
 *
 * `copyDay` had this check and nothing else did, so the ceiling it enforced was
 * one door among several: the entry dialog, a week-grid cell and a PM's absence
 * correction could each stack a day past 24 hours one save at a time.
 *
 * `replacing` names the rows this write takes the place of — the entry being
 * edited, the duplicates a grid cell collapses — so they are not counted
 * against themselves. And only GROWTH is refused: a day that is already over
 * (imported, or written before this check existed) must still accept an edit
 * that leaves it no fuller, or it could never be corrected downwards in steps.
 *
 * Not for the engines. A fill block is sized from what is left and so cannot
 * overrun, and a synced meeting mirrors the calendar; refusing either would
 * only make the day disagree with its source.
 *
 * Exported for `dayAssemblyService.apply`, which checks a whole accepted
 * proposal with it before writing any of it.
 */
export const assertDayHasRoom = async (
	ctx: Ctx,
	dateKey: string,
	durationSeconds: number,
	opts: {
		replacing?: (row: {
			id: string;
			calendarEventId: string | null;
		}) => boolean;
	} = {},
) => {
	const dayRows = await ctxDb(ctx).query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ctx.organizationId),
			eq(timeEntry.userId, ctx.userId),
			eq(timeEntry.date, dateKey),
		),
		columns: {
			id: true,
			durationSeconds: true,
			fillsDay: true,
			calendarEventId: true,
		},
	});
	const current = spokenForSeconds(dayRows);
	const next =
		spokenForSeconds(dayRows.filter((row) => !opts.replacing?.(row))) +
		durationSeconds;
	if (next > MAX_DAY_SECONDS && next > current) {
		throw new DayCapacityError(dateKey);
	}
};

/**
 * A Ctx for another person in the caller's organization, for the one write
 * that touches somebody else's day: a PM correcting their absence.
 *
 * It carries the caller's transaction, so the absence write and the fill block
 * it resizes land together, and the org timezone, which is the same for both.
 * It deliberately does NOT carry the caller's Access: that picture is the PM's,
 * and nothing done on the person's behalf may answer a question with it.
 */
const personCtx = (ctx: Ctx, userId: string): Ctx => {
	const person: Ctx = { organizationId: ctx.organizationId, userId };
	const memo = ctx[CTX_MEMO];
	if (memo) {
		Object.defineProperty(person, CTX_MEMO, {
			value: { timezone: memo.timezone, tx: memo.tx } satisfies CtxMemo,
			enumerable: false,
			writable: true,
			configurable: true,
		});
	}
	return person;
};

/** Project ids the given person is assigned to — used to decide whether a PM may
 *  correct that person's absence entries. */
const projectIdsForUser = async (ctx: Ctx, userId: string) => {
	const rows = await db
		.select({ projectId: projectMember.projectId })
		.from(projectMember)
		.where(
			and(
				eq(projectMember.organizationId, ctx.organizationId),
				eq(projectMember.userId, userId),
				eq(projectMember.active, true),
			),
		);
	return rows.map((r) => r.projectId);
};

/** May the caller READ this person's absence?
 *
 *  Own absence always: these are the person's own time entries, and `listRange`
 *  hands them back already — a stricter answer here would only mean the same
 *  rows were reachable one way and not another. The PM gate exists for OTHER
 *  people's absence, and stating it as `canOverrideAbsenceFor` alone left the
 *  trivial case out: a plain Member could not ask how much vacation they
 *  themselves had taken, because they are PM of nothing.
 *
 *  Reads only. The writes below keep calling `canOverrideAbsenceFor` directly
 *  and stay PM-only — correcting your OWN absence is `update`/`remove` on your
 *  own entry, which is a different door with its own ownership check. */
const canReadAbsenceOf = async (ctx: Ctx, userId: string): Promise<boolean> => {
	if (userId === ctx.userId) return true;
	const access = await ctxAccess(ctx);
	return access.canOverrideAbsenceFor(await projectIdsForUser(ctx, userId));
};

/** What a week copy did. `blockedDays` names the days that would have breached
 *  the 24-hour ceiling — reported rather than thrown, so one over-full
 *  Wednesday does not cost the other six days. */
type CopyWeekResult = {
	copied: number;
	skipped: number;
	blockedDays: string[];
};

export const timeEntriesService = {
	// Reading is reading. This used to run the recurring materializer and both
	// integration sync engines first, so which entries got created depended on
	// which screen was open — see the note above the engines. The worker owns
	// that now.
	//
	// The one write left below is not an import: a fill block's duration is
	// derived from what else the day holds, so it is recomputed (and dropped when
	// squeezed to nothing) against the rows just read. That keeps a value
	// consistent rather than inventing an entry.
	//
	// It is BOUNDED BY THE AUTOMATION WINDOW, though, and that is not a detail.
	// Unwindowed, this was the last write-on-read path in the app and it had the
	// widest reach of any of them: scrolling the Month view back — or, worse,
	// `GET /api/v1/time-entries?from=…&to=…`, whose range is caller-supplied —
	// rewrote and deleted fill blocks across the whole of a person's history,
	// including months already locked, finalized and invoiced. `targetSecondsFor`
	// reads the person's CURRENT working hours with no effective dating, so
	// shortening your day from 8h to 6h silently resized every fill block you had
	// ever had, the next time anyone happened to open that range.
	//
	// So a read may only touch what an automation may touch. Outside the window a
	// stored fill block is history and renders as it stands. Inside it, the block
	// still tracks the day. A person editing their own old entry is a different
	// thing entirely — a deliberate human act, which the app deliberately permits
	// in closed months — so the WRITE path's recompute (`recomputeDayFill`) stays
	// unwindowed. Automation is what the lock governs.
	listRange: async (ctx: Ctx, range: { from: string; to: string }) => {
		const tz = await ctxTimezone(ctx);

		const rows = await db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				gte(timeEntry.date, range.from),
				lte(timeEntry.date, range.to),
			),
			with: { project: { with: { client: true } }, task: true },
			orderBy: [asc(timeEntry.date), asc(timeEntry.createdAt)],
		});

		// Keep each day's fill block in sync on read: its duration tracks the day's
		// remaining working hours, so a sibling entry added elsewhere is absorbed.
		// A block squeezed down to nothing is dropped rather than shown as 0:00 —
		// same rule as recomputeDayFill, applied to the entries already in hand.
		const fills = rows.filter((r) => r.fillsDay);
		let visible = rows;
		// Only the fill blocks a background job would also have been allowed to
		// rewrite. `null` means the window is closed entirely (the lock covers
		// today), in which case a read touches nothing at all.
		const writable =
			fills.length > 0
				? automationWriteWindow(dayKeyInTz(new Date(), tz), {
						lockedThrough: (await orgSettingsService.get(ctx))
							.automationLockedThrough,
					})
				: null;
		const stale = writable
			? fills.filter((f) => f.date >= writable.from && f.date <= writable.to)
			: [];
		if (writable && stale.length > 0) {
			const [workingHours, holidays] = await Promise.all([
				workingHoursService.list(ctx),
				holidaysService.holidaySetForRange(ctx, writable.from, writable.to),
			]);
			const claimsByDay = new Map<string, typeof rows>();
			for (const r of rows) {
				const list = claimsByDay.get(r.date) ?? [];
				list.push(r);
				claimsByDay.set(r.date, list);
			}
			const emptied: string[] = [];
			for (const fill of stale) {
				const next = remainingSeconds(
					targetSecondsFor(workingHours, fill.date, tz, holidays),
					spokenForSeconds(claimsByDay.get(fill.date) ?? []),
				);
				if (next === 0) {
					emptied.push(fill.id);
					continue;
				}
				if (next === fill.durationSeconds) continue;
				await db
					.update(timeEntry)
					.set({ durationSeconds: next, updatedAt: new Date() })
					.where(eq(timeEntry.id, fill.id));
				fill.durationSeconds = next;
			}
			if (emptied.length > 0) {
				const dropped = new Set(emptied);
				await rehomeDroppedFillEvidence(
					ctx,
					stale.filter((fill) => dropped.has(fill.id)),
				);
				await db.delete(timeEntry).where(inArray(timeEntry.id, emptied));
				visible = rows.filter((r) => !dropped.has(r.id));
			}
		}

		// Commit and pull request counts, so the week grid can badge entries that
		// have work evidence attached (count queries rather than relations, to
		// avoid a domain.ts <-> github.ts import cycle).
		const commitCountById = new Map<string, number>();
		const pullRequestCountById = new Map<string, number>();
		if (visible.length > 0) {
			const ids = visible.map((r) => r.id);
			const commitCounts = await db
				.select({
					timeEntryId: timeEntryGithubCommit.timeEntryId,
					count: count(),
				})
				.from(timeEntryGithubCommit)
				.where(inArray(timeEntryGithubCommit.timeEntryId, ids))
				.groupBy(timeEntryGithubCommit.timeEntryId);
			for (const c of commitCounts) commitCountById.set(c.timeEntryId, c.count);

			// Pull requests, not events: three review rounds on one PR are one PR
			// on the badge.
			const pullRequestCounts = await db
				.select({
					timeEntryId: timeEntryGithubPrActivity.timeEntryId,
					count: countDistinct(timeEntryGithubPrActivity.pullRequestUrl),
				})
				.from(timeEntryGithubPrActivity)
				.where(inArray(timeEntryGithubPrActivity.timeEntryId, ids))
				.groupBy(timeEntryGithubPrActivity.timeEntryId);
			for (const c of pullRequestCounts) {
				pullRequestCountById.set(c.timeEntryId, c.count);
			}
		}

		return visible.map((row) => ({
			...row,
			commitCount: commitCountById.get(row.id) ?? 0,
			pullRequestCount: pullRequestCountById.get(row.id) ?? 0,
		}));
	},

	/**
	 * The meeting engine on its own, over exactly the window it is handed.
	 *
	 * A TEST SEAM, and the only caller is `services/meeting-sync.test.ts`.
	 * Production always goes through `runAutomationsForUser` below, which is where
	 * the window policy lives — this entrypoint deliberately has none, so calling
	 * it from a request or a job would reintroduce exactly the unbounded reach
	 * that lib/automation-window exists to prevent. Kept rather than folded into
	 * the test because the reissued-event dedup and delete-by-absence passes are
	 * the densest logic here and are worth driving over a fixed, legible range.
	 */
	syncMeetingsForUser: async (
		ctx: Ctx,
		range: { from: string; to: string },
	) => {
		const tz = await ctxTimezone(ctx);
		await syncMeetingsForRange(ctx, range, tz);
	},

	/**
	 * One person's automations, in the order they depend on each other. This is
	 * what the worker calls per (org, user) — see jobs/automation-sync.ts — and
	 * what the manual "Sync now" button calls for one person on demand.
	 *
	 * The order is load-bearing. A commit fill block claims "the rest of the
	 * day", and its duration is computed from what the day already holds, so the
	 * recurring break has to exist before it is sized. Running them the other way
	 * round produces a fill block that is half an hour too long and only
	 * self-corrects on the next read.
	 *
	 * Each engine gets its own window because each has its own switch, and the
	 * switches were flipped on different days. Every engine is independently
	 * best-effort: a revoked Google token must not cost this person their
	 * recurring blocks.
	 *
	 * The four outcomes are reported separately because they are four different
	 * answers. `skipped` in particular is not a quiet success: an engine whose
	 * window came back null did NOTHING, and folding that into `ran` is what let
	 * the "Sync now" button say "Synced" after a pass that touched nothing at all.
	 *
	 * `off` is the fourth: an engine the person has not switched on appeared in
	 * none of the other three, so "Sync now" could not distinguish "your calendar
	 * sync is off" from "synced" — which is the answer somebody who just came
	 * looking for their meetings actually needs.
	 */
	runAutomationsForUser: async (
		ctx: Ctx,
		opts: { now?: Date; tz?: string } = {},
	): Promise<{
		ran: string[];
		skipped: string[];
		failed: string[];
		off: string[];
	}> => {
		const tz = opts.tz ?? (await ctxTimezone(ctx));
		const todayKey = dayKeyInTz(opts.now ?? new Date(), tz);
		const ran: string[] = [];
		const skipped: string[] = [];
		const failed: string[] = [];
		const off: string[] = [];

		const attempt = async (name: string, work: () => Promise<void>) => {
			try {
				await work();
				ran.push(name);
			} catch (error) {
				failed.push(name);
				console.error(`[automations] ${name} failed`, {
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					error,
				});
			}
		};

		// Read once and apply to all three engines: the lock is a property of the
		// org's books, not of any one integration. A failure to read it must not
		// be interpreted as "unlocked", so it fails the whole pass rather than
		// silently writing into a closed month.
		let lockedThrough: string | null;
		try {
			lockedThrough = (await orgSettingsService.get(ctx))
				.automationLockedThrough;
		} catch (error) {
			console.error("[automations] lock read failed", error);
			return { ran, skipped, failed: [...failed, "org-settings"], off };
		}

		// Recurring blocks carry no integration switch: each rule holds its own
		// `activeSince`, which materializeRange applies per rule.
		const blockWindow = automationWriteWindow(todayKey, { lockedThrough });
		if (blockWindow) {
			await attempt("recurring-blocks", () =>
				recurringBlockRulesService.materializeRange(
					ctx,
					blockWindow.from,
					blockWindow.to,
				),
			);
		} else {
			skipped.push("recurring-blocks");
		}

		let settings: Awaited<ReturnType<typeof integrationSettingsService.get>>;
		try {
			settings = await integrationSettingsService.get(ctx);
		} catch (error) {
			console.error("[automations] settings read failed", error);
			return { ran, skipped, failed: [...failed, "integration-settings"], off };
		}

		if (settings.googleAutoSyncMeetings) {
			const window = automationWriteWindow(todayKey, {
				since: enabledSinceKey(settings.googleAutoSyncMeetingsSince, tz),
				lockedThrough,
			});
			if (window) {
				await attempt("meetings", () => syncMeetingsForRange(ctx, window, tz));
			} else {
				skipped.push("meetings");
			}
		} else {
			off.push("meetings");
		}

		if (settings.githubSyncCommitsAsWorkTime) {
			const window = automationWriteWindow(todayKey, {
				since: enabledSinceKey(settings.githubSyncCommitsAsWorkTimeSince, tz),
				lockedThrough,
				// The one engine that may only write to days that are over: its block
				// is sized from the day's WHOLE working target, which is a claim about
				// a day that has been worked. See AutomationBounds.completeDaysOnly.
				// Today is still reachable on demand — Assemble my day proposes the
				// same fill without writing it.
				completeDaysOnly: true,
			});
			if (window) {
				await attempt("commit-work-time", () =>
					syncCommitWorkTimeForRange(ctx, window, tz),
				);
			} else {
				skipped.push("commit-work-time");
			}
		} else {
			off.push("commit-work-time");
		}

		return { ran, skipped, failed, off };
	},

	/** One of the caller's OWN entries by id, or undefined.
	 *
	 *  Ownership is the filter rather than a check that throws, matching `remove`
	 *  one door down: the caller for this is the assistant's approval card, which
	 *  needs to name what is about to be deleted, and a card that threw instead of
	 *  rendering would leave somebody unable to answer either way. */
	getOwn: async (ctx: Ctx, timeEntryId: string) =>
		db.query.timeEntry.findFirst({
			where: and(
				eq(timeEntry.id, timeEntryId),
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
			),
			with: { task: true },
		}),

	create: async (
		ctx: Ctx,
		input: CreateTimeEntryInput,
		// `unasked`: the caller had no way to ask for a description (the week
		// grid's cells). Every path where a person is filling in a form leaves it
		// unset and gets the rule.
		{ unasked = false }: { unasked?: boolean } = {},
	) => {
		if (input.projectId) {
			await assertProjectInOrg(ctx, input.projectId);
			const access = await ctxAccess(ctx);
			access.assertCanTrackOn(input.projectId);
		}
		const taskRow = await assertTaskAvailable(
			ctx,
			input.taskId,
			input.projectId,
		);
		if (!unasked) {
			assertDescribed(taskRow, input.description, { fillsDay: input.fillsDay });
		}

		const tz = await ctxTimezone(ctx);
		const durationSeconds = input.fillsDay
			? await computeDayFillSeconds(ctx, input.date, tz)
			: (input.durationSeconds ?? 0);

		// A fill block with nothing left to fill is not an entry, it's a 0:00 row.
		// Refuse it up front with a reason rather than storing one — the mirror of
		// recomputeDayFill deleting a block that has been squeezed down to nothing.
		if (input.fillsDay && durationSeconds === 0) {
			throw new Error(
				"This day's working hours are already fully logged — nothing left to fill",
			);
		}

		const values = {
			organizationId: ctx.organizationId,
			userId: ctx.userId,
			projectId: input.projectId ?? null,
			taskId: input.taskId,
			date: input.date,
			description: input.description?.trim() ?? "",
			durationSeconds,
			overtime: input.overtime,
			fillsDay: input.fillsDay,
			meetingUrl: input.meetingUrl ?? null,
			calendarEventId: input.calendarEventId ?? null,
			// A hand-created entry that attaches a calendar event is user-owned, not
			// sync-owned — lock it so the sync engine never overwrites or deletes it.
			syncLocked: input.calendarEventId != null,
		};

		return withCtxTx(ctx, async (txCtx) => {
			const tx = ctxDb(txCtx);
			// A fill block is sized from what is left, so it can never overrun. An
			// entry that attaches a calendar event replaces that event's synced row
			// (the upsert below), so that row does not count against it.
			if (!input.fillsDay) {
				await assertDayHasRoom(txCtx, input.date, durationSeconds, {
					replacing: (existing) =>
						input.calendarEventId != null &&
						existing.calendarEventId === input.calendarEventId,
				});
			}
			let row: typeof timeEntry.$inferSelect | undefined;
			if (input.fillsDay) {
				[row] = await tx
					.insert(timeEntry)
					.values(values)
					.onConflictDoNothing({
						target: [
							timeEntry.organizationId,
							timeEntry.userId,
							timeEntry.date,
						],
						where: sql`${timeEntry.fillsDay} = true`,
					})
					.returning();
				if (!row) {
					throw new Error("A work-time block already exists for this day");
				}
				// Deliberately asking for a rest-of-day block retracts an earlier "no"
				// on this day. Without this, deleting the block once would suppress the
				// engine on that day forever, including after the person changed their
				// mind and made one by hand — a tombstone outliving the decision it
				// recorded.
				await tx
					.delete(commitFillTombstone)
					.where(
						and(
							eq(commitFillTombstone.organizationId, ctx.organizationId),
							eq(commitFillTombstone.userId, ctx.userId),
							eq(commitFillTombstone.date, input.date),
						),
					);
			} else if (input.calendarEventId) {
				// Manually attaching an event meeting-sync may already have imported
				// would otherwise hit te_calendar_event_uidx and throw a raw 500. Take
				// ownership of the existing synced row instead.
				[row] = await tx
					.insert(timeEntry)
					.values(values)
					.onConflictDoUpdate({
						target: [
							timeEntry.organizationId,
							timeEntry.userId,
							timeEntry.calendarEventId,
						],
						targetWhere: sql`${timeEntry.calendarEventId} is not null`,
						set: {
							projectId: values.projectId,
							taskId: values.taskId,
							date: values.date,
							description: values.description,
							durationSeconds: values.durationSeconds,
							overtime: values.overtime,
							meetingUrl: values.meetingUrl,
							syncLocked: true,
						},
					})
					.returning();
			} else {
				[row] = await tx.insert(timeEntry).values(values).returning();
			}
			if (!row) throw new Error("Failed to create time entry");

			// Deliberately creating an entry for a calendar event un-tombstones it.
			// Deleting a synced meeting writes a tombstone so the sync engine leaves
			// it deleted; without this, that decision was permanent and nothing —
			// not undo, not a re-sync — could ever bring the meeting back.
			if (input.calendarEventId) {
				await tx
					.delete(syncedMeetingTombstone)
					.where(
						and(
							eq(syncedMeetingTombstone.organizationId, ctx.organizationId),
							eq(syncedMeetingTombstone.userId, ctx.userId),
							eq(syncedMeetingTombstone.calendarEventId, input.calendarEventId),
						),
					);
			}

			// A new normal entry shrinks whatever fill block shares its day.
			if (!input.fillsDay) await recomputeDayFill(txCtx, input.date, tz);
			return row;
		});
	},

	update: async (ctx: Ctx, input: UpdateTimeEntryInput) => {
		const existing = await db.query.timeEntry.findFirst({
			where: and(
				eq(timeEntry.id, input.timeEntryId),
				eq(timeEntry.organizationId, ctx.organizationId),
				// People edit their own entries — including in months that are already
				// closed, deliberately (PRD decision 2). PMs never edit other people's
				// worked time.
				eq(timeEntry.userId, ctx.userId),
			),
		});
		if (!existing) throw new Error("Time entry not found");

		if (input.projectId) {
			await assertProjectInOrg(ctx, input.projectId);
			const access = await ctxAccess(ctx);
			access.assertCanTrackOn(input.projectId);
		}
		const taskRow = await assertTaskAvailable(
			ctx,
			input.taskId,
			input.projectId,
		);
		assertDescribed(taskRow, input.description, { fillsDay: input.fillsDay });

		const tz = await ctxTimezone(ctx);
		// The entry being edited is excluded from its own claim: converting a 2h
		// block into the day's fill block must not count that 2h as competing with
		// the fill it is becoming.
		const durationSeconds = input.fillsDay
			? await computeDayFillSeconds(ctx, input.date, tz, {
					excludeEntryId: input.timeEntryId,
				})
			: (input.durationSeconds ?? 0);

		if (input.fillsDay && durationSeconds === 0) {
			throw new Error(
				"This day's working hours are already fully logged — nothing left to fill",
			);
		}

		const updated = await withCtxTx(ctx, async (txCtx) => {
			// Against the day the entry is moving TO, with the entry itself left
			// out: an edit that keeps its length on its own day changes nothing.
			if (!input.fillsDay) {
				await assertDayHasRoom(txCtx, input.date, durationSeconds, {
					replacing: (row) => row.id === input.timeEntryId,
				});
			}
			let row: typeof timeEntry.$inferSelect | undefined;
			try {
				[row] = await ctxDb(txCtx)
					.update(timeEntry)
					.set({
						// Full-form edit: an absent project means "cleared", not "leave
						// unchanged" (drizzle skips `undefined` in .set()).
						projectId: input.projectId ?? null,
						taskId: input.taskId,
						date: input.date,
						description: input.description?.trim() ?? "",
						durationSeconds,
						overtime: input.overtime,
						fillsDay: input.fillsDay,
						// Unlike project above, an absent meeting is "leave as-is": editing
						// an entry's other fields never wipes a previously attached link.
						meetingUrl: input.meetingUrl,
						calendarEventId: input.calendarEventId,
						// Editing a calendar-linked entry takes it out of the sync
						// engine's hands for good.
						syncLocked:
							existing.calendarEventId != null || input.calendarEventId != null
								? true
								: undefined,
						updatedAt: new Date(),
					})
					.where(eq(timeEntry.id, input.timeEntryId))
					.returning();
			} catch (error) {
				if (
					error instanceof postgres.PostgresError &&
					error.code === "23505" &&
					error.constraint_name === "te_fill_day_uidx"
				) {
					throw new Error("A work-time block already exists for this day");
				}
				throw error;
			}

			await recomputeDayFill(txCtx, input.date, tz);
			if (existing.date !== input.date) {
				await recomputeDayFill(txCtx, existing.date, tz);
			}
			return row;
		});
		return updated;
	},

	/**
	 * File an unfiled entry against a project — the one thing the time page's
	 * unfiled worklist does. Narrower than `update` on purpose: filing must not
	 * require the caller to resupply date, duration and task just to attribute a
	 * synced meeting, and the entry keeps its duration, so there is no fill to
	 * recompute.
	 */
	file: async (ctx: Ctx, input: FileTimeEntryInput) => {
		const existing = await db.query.timeEntry.findFirst({
			where: and(
				eq(timeEntry.id, input.timeEntryId),
				eq(timeEntry.organizationId, ctx.organizationId),
				// Filing is self-service: nobody else attributes your time for you.
				eq(timeEntry.userId, ctx.userId),
			),
			columns: { id: true, taskId: true, calendarEventId: true },
		});
		if (!existing) throw new Error("Time entry not found");

		await assertProjectInOrg(ctx, input.projectId);
		const access = await ctxAccess(ctx);
		access.assertCanTrackOn(input.projectId);
		// The task still has to be one the target project picked, exactly as if the
		// entry had been created against that project by hand.
		await assertTaskAvailable(ctx, existing.taskId, input.projectId);

		const [updated] = await db
			.update(timeEntry)
			.set({
				projectId: input.projectId,
				// Filing a synced meeting is the user taking ownership of it; without
				// this the next sync would treat it as its own row again.
				syncLocked: existing.calendarEventId != null ? true : undefined,
				updatedAt: new Date(),
			})
			.where(eq(timeEntry.id, input.timeEntryId))
			.returning();
		if (!updated) throw new Error("Failed to file entry");
		return updated;
	},

	/**
	 * File many entries against one project in a single call.
	 *
	 * Best-effort per entry rather than all-or-nothing: the one thing that
	 * legitimately fails here is a task the target project has not picked, and a
	 * mixed selection (a Meeting and a Design review, say) would otherwise be
	 * refused whole with no indication of which row was the problem. The caller
	 * gets a count and the first reason, and the entries that could be filed are.
	 */
	fileMany: async (ctx: Ctx, input: FileTimeEntriesInput) => {
		// Resolved once for the whole batch — `file` re-checks per entry, but the
		// project-level checks would otherwise be repeated up to 200 times.
		await assertProjectInOrg(ctx, input.projectId);
		const access = await ctxAccess(ctx);
		access.assertCanTrackOn(input.projectId);

		let filed = 0;
		const reasons: string[] = [];
		// What was actually filed, for `remember` below — collected from the
		// returned rows rather than from the request, so a rule can only ever be
		// recorded for an entry that really moved.
		const succeeded: { taskId: string; description: string }[] = [];
		for (const timeEntryId of input.timeEntryIds) {
			try {
				const entry = await timeEntriesService.file(ctx, {
					timeEntryId,
					projectId: input.projectId,
				});
				succeeded.push({
					taskId: entry.taskId,
					description: entry.description ?? "",
				});
				filed++;
			} catch (error) {
				reasons.push(
					error instanceof Error ? error.message : "Could not file entry",
				);
			}
		}

		// Best-effort, and deliberately after the filing rather than alongside it:
		// the hours are the write that matters and they are already committed, so a
		// preference that fails to save must not turn a successful filing into an
		// error toast. `remembered` is reported instead, and it is 0 when nothing
		// carried a title worth keying on.
		let remembered = 0;
		if (input.remember && succeeded.length > 0) {
			try {
				remembered = await filingRulesService.rememberFrom(
					ctx,
					input.projectId,
					succeeded,
				);
			} catch (error) {
				console.error("[time-entries] could not save filing rules", error);
			}
		}

		return {
			filed,
			failed: reasons.length,
			firstError: reasons[0],
			remembered,
		};
	},

	/** Inline note edit. No duration/day change, so no fill recompute. */
	updateDescription: async (
		ctx: Ctx,
		input: UpdateTimeEntryDescriptionInput,
	) => {
		const existing = await db.query.timeEntry.findFirst({
			where: and(
				eq(timeEntry.id, input.timeEntryId),
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
			),
			columns: { id: true, calendarEventId: true },
		});
		if (!existing) throw new Error("Time entry not found");

		const [updated] = await db
			.update(timeEntry)
			.set({
				description: input.description,
				syncLocked: existing.calendarEventId != null ? true : undefined,
				updatedAt: new Date(),
			})
			.where(eq(timeEntry.id, input.timeEntryId))
			.returning();
		if (!updated) throw new Error("Failed to update note");
		return updated;
	},

	/** Overtime is purely manual — this is the only thing that ever sets it. */
	setOvertime: async (ctx: Ctx, input: SetTimeEntryOvertimeInput) => {
		const [updated] = await db
			.update(timeEntry)
			.set({ overtime: input.overtime, updatedAt: new Date() })
			.where(
				and(
					eq(timeEntry.id, input.timeEntryId),
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
				),
			)
			.returning();
		if (!updated) throw new Error("Time entry not found");
		return updated;
	},

	remove: async (ctx: Ctx, timeEntryId: string) => {
		return withCtxTx(ctx, async (txCtx) => {
			const tx = ctxDb(txCtx);
			const [existing] = await tx
				.delete(timeEntry)
				.where(
					and(
						eq(timeEntry.id, timeEntryId),
						eq(timeEntry.organizationId, ctx.organizationId),
						eq(timeEntry.userId, ctx.userId),
					),
				)
				.returning();

			if (existing?.generatedFromRuleId && existing.generatedForDate) {
				await tx
					.insert(recurringBlockRuleSkip)
					.values({
						ruleId: existing.generatedFromRuleId,
						date: existing.generatedForDate,
					})
					.onConflictDoNothing();
			}

			// Deleting an auto-synced meeting must make it "stay deleted".
			if (existing?.calendarEventId) {
				await tx
					.insert(syncedMeetingTombstone)
					.values({
						organizationId: ctx.organizationId,
						userId: ctx.userId,
						calendarEventId: existing.calendarEventId,
					})
					.onConflictDoNothing();
			}

			// And so must deleting the day's rest-of-day block. The commit engine's
			// only guard was the one-fill-per-day index, which the deletion itself
			// clears — so without this the next sweep files another one, twenty
			// minutes later, with nobody watching.
			if (existing?.fillsDay) {
				await tx
					.insert(commitFillTombstone)
					.values({
						organizationId: ctx.organizationId,
						userId: ctx.userId,
						date: existing.date,
					})
					.onConflictDoNothing();
			}
			// Inside the transaction: the deletion and the fill block it resizes
			// have to land together, or a reader between the two sees a day whose
			// fill has not yet absorbed the freed time.
			if (existing && !existing.fillsDay) {
				const tz = await ctxTimezone(txCtx);
				await recomputeDayFill(txCtx, existing.date, tz);
			}

			// Returned so the caller can offer an "undo" that re-creates the row.
			return existing ?? null;
		});
	},

	/**
	 * Write one cell of the week grid: "this project+task, on this date, is now
	 * N seconds". Zero clears it.
	 *
	 * The grid's unit is a (project, task, day) triple, not an entry id — that's
	 * what makes typing into a box work without the client tracking which cells
	 * already have rows behind them. Where several entries share the triple (a
	 * synced meeting plus a manual one, say), the grid collapses them: the first
	 * absorbs the new total and the rest are removed, because showing 6:00 in a
	 * box and then leaving 8:00 in the database would make the grid lie.
	 *
	 * Derived entries are deliberately out of scope — a fill block is computed
	 * from the day's remaining hours, so letting a cell overwrite it would just
	 * be undone on the next read.
	 */
	setWeekCell: async (ctx: Ctx, input: SetWeekCellInput) => {
		if (input.projectId) {
			await assertProjectInOrg(ctx, input.projectId);
			const access = await ctxAccess(ctx);
			access.assertCanTrackOn(input.projectId);
		}
		await assertTaskAvailable(ctx, input.taskId, input.projectId);

		// One transaction for the whole cell write. `remove` and `create` below are
		// this same service and open their own transactions when called directly;
		// handed a Ctx that already carries one they join it instead, so clearing
		// three duplicates and resizing the fill block is one atomic write rather
		// than five independent ones.
		return withCtxTx(ctx, async (txCtx) => {
			const tx = ctxDb(txCtx);
			const matches = await tx.query.timeEntry.findMany({
				where: and(
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
					eq(timeEntry.date, input.date),
					eq(timeEntry.taskId, input.taskId),
					input.projectId
						? eq(timeEntry.projectId, input.projectId)
						: isNull(timeEntry.projectId),
					eq(timeEntry.fillsDay, false),
				),
				orderBy: [asc(timeEntry.createdAt)],
			});

			const tz = await ctxTimezone(txCtx);
			const [primary, ...duplicates] = matches;

			if (input.durationSeconds === 0) {
				for (const row of matches) {
					await timeEntriesService.remove(txCtx, row.id);
				}
				return { cleared: matches.length };
			}

			if (primary) {
				// The cell's new total replaces every row it collapses, so all of
				// them come off the day before the new figure is added back on.
				const collapsed = new Set(matches.map((row) => row.id));
				await assertDayHasRoom(txCtx, input.date, input.durationSeconds, {
					replacing: (row) => collapsed.has(row.id),
				});
				const patch: Partial<typeof timeEntry.$inferInsert> = {
					durationSeconds: input.durationSeconds,
					updatedAt: new Date(),
				};
				if (input.description !== undefined) {
					patch.description = input.description.trim();
				}
				// Typing into a synced meeting's cell is the person overriding the
				// calendar, the same act as `update`, `file` and `updateDescription`,
				// which all take the row out of the sync engine's hands. Without this
				// the next sync set the duration straight back to the calendar's.
				if (primary.calendarEventId != null) patch.syncLocked = true;
				await tx
					.update(timeEntry)
					.set(patch)
					.where(eq(timeEntry.id, primary.id));
				for (const row of duplicates) {
					await timeEntriesService.remove(txCtx, row.id);
				}
				await recomputeDayFill(txCtx, input.date, tz);
				return { entryId: primary.id };
			}

			// Creating fresh. The grid sends no description, so this is normally an
			// empty note, filled in afterwards through the row's note button — the
			// mandatory-description rule is enforced where a person is being asked
			// the question (`create` without `unasked`). A spreadsheet cell cannot
			// answer it.
			const description = input.description?.trim() ?? "";
			const created = await timeEntriesService.create(
				txCtx,
				{
					date: input.date,
					projectId: input.projectId,
					taskId: input.taskId,
					description: description || undefined,
					durationSeconds: input.durationSeconds,
					overtime: false,
					fillsDay: false,
				},
				{ unasked: true },
			);
			return { entryId: created.id };
		});
	},

	/** Copy a day's entries onto another day. The backfill affordance that stands
	 *  in for a running timer: most people work a similar shape most days.
	 *
	 *  Four rules, each of which used to be missing:
	 *
	 *  - A calendar-derived entry IS copied, as a plain manual entry. It used to
	 *    be skipped on the reasoning that "a meeting belongs to the day it
	 *    happened" — true of the calendar link, not of the time. Combined with
	 *    the tombstone written on delete, skipping it meant a meeting entry
	 *    deleted by mistake could not be recovered by ANY route. The link
	 *    (`calendarEventId`, `meetingUrl`) is deliberately not carried over: the
	 *    copy is new, hand-made time that happens to look like a meeting, and
	 *    binding it to an event on another day would put it back under the sync
	 *    engine's control.
	 *  - A fill block IS copied — RE-DERIVED, not duplicated. Its duration is a
	 *    function of what the TARGET day leaves over, so it is recreated at that
	 *    size rather than at the source's. Dropping it entirely (which is what
	 *    "copying one forward would just be recomputed away" actually did) meant
	 *    a day whose hours live in a single "rest of day" block — the shape the
	 *    day assembler produces — copied across as nothing at all, which is the
	 *    "the copy button sometimes doesn't copy the day" report.
	 *  - Copying twice is a no-op, not a doubling. An entry whose (project, task,
	 *    duration, note) already sits on the target day is skipped, so leaning on
	 *    the button is harmless.
	 *  - The result must fit in a day. */
	copyDay: async (ctx: Ctx, input: CopyTimeEntriesInput) => {
		if (input.fromDate === input.toDate) return { copied: 0, skipped: 0 };

		return withCtxTx(ctx, async (txCtx) => {
			const tx = ctxDb(txCtx);
			// Fill blocks included, unlike before: they are handled separately below
			// rather than filtered out of the read, because the target's fill block
			// is also what decides whether the source's can be recreated at all.
			const dayRows = (date: string) =>
				tx.query.timeEntry.findMany({
					where: and(
						eq(timeEntry.organizationId, ctx.organizationId),
						eq(timeEntry.userId, ctx.userId),
						eq(timeEntry.date, date),
					),
				});

			const [source, target] = await Promise.all([
				dayRows(input.fromDate),
				dayRows(input.toDate),
			]);
			if (source.length === 0) return { copied: 0, skipped: 0 };

			// What makes two entries "the same work" for the purpose of not copying
			// it twice. Deliberately not the entry id — the point is to recognise a
			// row this same button already produced on a previous click.
			const sameWork = (e: {
				projectId: string | null;
				taskId: string;
				durationSeconds: number;
				description: string;
			}) =>
				`${e.projectId ?? "none"}|${e.taskId}|${e.durationSeconds}|${e.description.trim()}`;

			const alreadyThere = new Set(
				target.filter((e) => !e.fillsDay).map(sameWork),
			);
			const copyable: typeof source = [];
			for (const entry of source) {
				if (entry.fillsDay) continue;
				const key = sameWork(entry);
				if (alreadyThere.has(key)) continue;
				// Guards against a source day that itself holds two identical rows.
				alreadyThere.add(key);
				copyable.push(entry);
			}

			// Copying is a WRITE, and it used to be the one write that checked
			// nothing: `create` and `setWeekCell` both assert the project is in the
			// org, that the caller may track on it, and that the task is still picked
			// for it — copyDay inserted straight through. Tenancy was never at risk
			// (the source rows are the caller's own), but taxonomy and assignment
			// were: a project you have been removed from, or a task the project has
			// since un-picked, came back with one click. The resulting row could then
			// never be edited, because `update` does run the guards.
			//
			// Checked per distinct (project, task) pair rather than per row: a day is
			// usually a handful of pairs across many entries, and the answer cannot
			// differ within a pair.
			const access = await ctxAccess(txCtx);
			const verdicts = new Map<string, boolean>();
			const mayCopy = async (e: {
				projectId: string | null;
				taskId: string;
			}): Promise<boolean> => {
				const key = `${e.projectId ?? ""}|${e.taskId}`;
				const cached = verdicts.get(key);
				if (cached !== undefined) return cached;
				let allowed = true;
				try {
					if (e.projectId) {
						await assertProjectInOrg(txCtx, e.projectId);
						access.assertCanTrackOn(e.projectId);
					}
					await assertTaskAvailable(txCtx, e.taskId, e.projectId ?? undefined);
				} catch (error) {
					// A guard says no by throwing; anything else is a real failure and
					// must not be reported to the person as "skipped".
					if (error instanceof postgres.PostgresError) throw error;
					allowed = false;
				}
				verdicts.set(key, allowed);
				return allowed;
			};

			const permitted: typeof source = [];
			for (const entry of copyable) {
				if (await mayCopy(entry)) permitted.push(entry);
			}

			// A day may hold at most one fill block (`te_fill_day_uidx`), so the
			// target's own survives and simply resizes around what just landed.
			const sourceFill = source.find((e) => e.fillsDay);
			const copyFill =
				sourceFill !== undefined &&
				!target.some((e) => e.fillsDay) &&
				(await mayCopy(sourceFill));

			let copied = permitted.length;
			let skipped = source.length - copied - (copyFill ? 1 : 0);
			if (copied === 0 && !copyFill) return { copied: 0, skipped };

			const addedSeconds = permitted.reduce(
				(sum, e) => sum + e.durationSeconds,
				0,
			);
			const existingSeconds = spokenForSeconds(target);
			if (existingSeconds + addedSeconds > MAX_DAY_SECONDS) {
				throw new DayCapacityError(input.toDate);
			}

			if (permitted.length > 0) {
				await tx.insert(timeEntry).values(
					permitted.map((e) => ({
						organizationId: ctx.organizationId,
						userId: ctx.userId,
						projectId: e.projectId,
						taskId: e.taskId,
						date: input.toDate,
						description: e.description,
						durationSeconds: e.durationSeconds,
						overtime: e.overtime,
					})),
				);
			}

			const tz = await ctxTimezone(txCtx);
			if (copyFill && sourceFill) {
				// Sized last, from what the rows just inserted left over. Zero means
				// the target day is already spoken for and the block would describe
				// nothing, so it is not written at all — the same call `recomputeDayFill`
				// makes when an existing one recomputes to zero.
				const fillSeconds = await computeDayFillSeconds(
					txCtx,
					input.toDate,
					tz,
				);
				if (fillSeconds > 0) {
					await tx.insert(timeEntry).values({
						organizationId: ctx.organizationId,
						userId: ctx.userId,
						projectId: sourceFill.projectId,
						taskId: sourceFill.taskId,
						date: input.toDate,
						description: sourceFill.description,
						durationSeconds: fillSeconds,
						overtime: sourceFill.overtime,
						fillsDay: true,
					});
					copied += 1;
				} else {
					skipped += 1;
				}
			} else {
				await recomputeDayFill(txCtx, input.toDate, tz);
			}
			return { copied, skipped };
		});
	},

	/** `copyDay` seven times, pairing the weeks up by offset so last Tuesday
	 *  lands on this Tuesday.
	 *
	 *  A day that would breach the 24-hour ceiling is reported rather than
	 *  aborting the week: one over-full Wednesday should not cost you the other
	 *  six days. `copyDay` checks the ceiling before it writes anything, so
	 *  catching here cannot leave a day half-copied. */
	copyWeek: async (
		ctx: Ctx,
		input: CopyWeekEntriesInput,
	): Promise<CopyWeekResult> => {
		if (input.fromWeekStart === input.toWeekStart) {
			return { copied: 0, skipped: 0, blockedDays: [] };
		}

		return withCtxTx(ctx, async (txCtx) => {
			let copied = 0;
			let skipped = 0;
			const blockedDays: string[] = [];

			for (let offset = 0; offset < 7; offset++) {
				const fromDate = addDaysToKey(input.fromWeekStart, offset);
				const toDate = addDaysToKey(input.toWeekStart, offset);
				try {
					const result = await timeEntriesService.copyDay(txCtx, {
						fromDate,
						toDate,
					});
					copied += result.copied;
					skipped += result.skipped;
				} catch (error) {
					// Only the day's own capacity refusal is a "blocked day". Anything
					// else is a real failure and has to abort the transaction rather
					// than be reported as a full day.
					if (!(error instanceof DayCapacityError)) throw error;
					blockedDays.push(toDate);
				}
			}

			return { copied, skipped, blockedDays };
		});
	},

	// ── Absence corrections (PM / Admin) ──────────────────────────────────────
	// PMs can override or correct Vacation and Sick Leave entries for people on
	// their projects (PRD 3.5). This is the ONE case where someone edits another
	// person's entries — and it is deliberately limited to absence: nobody edits
	// another person's worked time.

	/** One person's Vacation/Sick entries for a month, for the PM correcting them.
	 *  Same permission as the writes below — a PM may read
	 *  the absence of people on their own projects, nobody else's. */
	listAbsenceForUser: async (ctx: Ctx, input: ListAbsenceForUserInput) => {
		if (!(await canReadAbsenceOf(ctx, input.userId))) {
			throw new AccessError("You cannot see this person's absence");
		}
		const { from, to } = monthBounds(input.year, input.month);
		return db
			.select({
				id: timeEntry.id,
				date: timeEntry.date,
				taskId: timeEntry.taskId,
				taskName: task.name,
				description: timeEntry.description,
				durationSeconds: timeEntry.durationSeconds,
			})
			.from(timeEntry)
			.innerJoin(task, eq(timeEntry.taskId, task.id))
			.where(
				and(
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, input.userId),
					eq(task.isAbsence, true),
					gte(timeEntry.date, from),
					lte(timeEntry.date, to),
				),
			)
			.orderBy(asc(timeEntry.date));
	},

	/** A whole year of absence, grouped by task — "how much vacation have I
	 *  taken", which the month-shaped read above answers only twelve calls at a
	 *  time.
	 *
	 *  Days as well as seconds, converted with the same `WORKING_DAY_SECONDS`
	 *  Expected subtracts absence with. Two divisors would mean
	 *  a person and their PM reading different day counts off the same rows. */
	absenceTotals: async (ctx: Ctx, input: AbsenceTotalsInput) => {
		const userId = input.userId ?? ctx.userId;
		if (!(await canReadAbsenceOf(ctx, userId))) {
			throw new AccessError("You cannot see this person's absence");
		}

		const rows = await db
			.select({
				taskId: task.id,
				taskName: task.name,
				seconds: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
			})
			.from(timeEntry)
			.innerJoin(task, eq(timeEntry.taskId, task.id))
			.where(
				ledgerWhere(
					ctx,
					{ from: `${input.year}-01-01`, to: `${input.year}-12-31` },
					"absence",
					{ userId },
				),
			)
			.groupBy(task.id, task.name)
			.orderBy(asc(task.name));

		return rows.map((row) => {
			const seconds = Number(row.seconds);
			return {
				taskId: row.taskId,
				taskName: row.taskName,
				seconds,
				days: Math.round((seconds / WORKING_DAY_SECONDS) * 100) / 100,
			};
		});
	},

	/**
	 * Book absence across a span of days, for the caller.
	 *
	 * The expansion is the point. "I'm off the 4th to the 15th" is one sentence
	 * and, day by day through `create`, ten calls — and the two rules that decide
	 * WHICH of those days get an entry are not visible to a caller: the person's
	 * own working-hours schedule (somebody who does not work Wednesdays takes no
	 * Wednesday off) and the org's holiday calendar. Booked against the day's own
	 * target rather than a flat eight hours, so a four-hour Friday costs four.
	 *
	 * Days that cannot take an entry are REPORTED rather than skipped silently:
	 * "booked 8 days, skipped 3" is the difference between a caller that can tell
	 * the person what happened and one that claims a fortnight it did not book.
	 * A day that already carries absence is left alone — asking twice must not
	 * book twice — and per-day failures are collected the same way, so one bad day
	 * (a 24h ceiling, a task archived mid-loop) cannot abandon the range half
	 * written.
	 *
	 * Self only. Booking absence FOR somebody else is `createAbsenceForUser`,
	 * which is PM-gated; nothing here widens that.
	 */
	logAbsenceRange: async (ctx: Ctx, input: LogAbsenceRangeInput) => {
		const absenceIds = await tasksService.absenceTaskIds();
		if (!absenceIds.has(input.taskId)) {
			throw new Error("Only absence tasks can be logged this way");
		}

		const range = { from: input.from, to: input.to };
		const [tz, workingHours, holidays, existing] = await Promise.all([
			ctxTimezone(ctx),
			workingHoursService.list(ctx),
			holidaysService.holidaySetForRange(ctx, input.from, input.to),
			db
				.select({ date: timeEntry.date })
				.from(timeEntry)
				.innerJoin(task, eq(timeEntry.taskId, task.id))
				.where(ledgerWhere(ctx, range, "absence", { userId: ctx.userId })),
		]);
		const alreadyOff = new Set(existing.map((row) => row.date));

		const booked: { date: string; durationSeconds: number }[] = [];
		const skipped: { date: string; reason: string }[] = [];

		for (const date of datesBetween(input.from, input.to)) {
			if (holidays.has(date)) {
				skipped.push({ date, reason: "public holiday" });
				continue;
			}
			// The zero check comes BEFORE the snap, not after: `snapToQuarterHour`
			// has a 15-minute floor (so a 3-minute meeting becomes a real block
			// rather than vanishing), which turns "this person does not work
			// Saturdays" into a quarter hour of vacation booked on a Saturday.
			const targetSeconds = targetSecondsFor(workingHours, date, tz, holidays);
			if (targetSeconds === 0) {
				skipped.push({ date, reason: "not a working day for this person" });
				continue;
			}
			// Snapped because a schedule is stored as two clock times and can
			// describe a day that is not a whole number of quarter hours, which
			// every other duration in the system is.
			const durationSeconds = snapToQuarterHour(targetSeconds);
			if (alreadyOff.has(date)) {
				skipped.push({ date, reason: "absence already logged" });
				continue;
			}

			try {
				await timeEntriesService.create(ctx, {
					date,
					taskId: input.taskId,
					description: input.description,
					durationSeconds,
					overtime: false,
					fillsDay: false,
				});
				booked.push({ date, durationSeconds });
			} catch (error) {
				skipped.push({
					date,
					reason:
						error instanceof Error ? error.message : "could not be logged",
				});
			}
		}

		return { booked, skipped };
	},

	overrideAbsence: async (ctx: Ctx, input: OverrideAbsenceEntryInput) => {
		const existing = await db.query.timeEntry.findFirst({
			where: and(
				eq(timeEntry.id, input.timeEntryId),
				eq(timeEntry.organizationId, ctx.organizationId),
			),
			with: { task: true },
		});
		if (!existing) throw new Error("Time entry not found");
		if (!existing.task.isAbsence) {
			throw new Error("Only absence entries can be corrected");
		}

		const access = await ctxAccess(ctx);
		const shared = await projectIdsForUser(ctx, existing.userId);
		if (!access.canOverrideAbsenceFor(shared)) {
			throw new AccessError("You cannot correct this person's absence");
		}

		const patch: Partial<typeof timeEntry.$inferInsert> = {
			durationSeconds: input.durationSeconds,
			updatedAt: new Date(),
		};
		if (input.description !== undefined) patch.description = input.description;

		const tz = await ctxTimezone(ctx);
		return withCtxTx(ctx, async (txCtx) => {
			const person = personCtx(txCtx, existing.userId);
			await assertDayHasRoom(person, existing.date, input.durationSeconds, {
				replacing: (row) => row.id === existing.id,
			});
			const [updated] = await ctxDb(txCtx)
				.update(timeEntry)
				.set(patch)
				.where(eq(timeEntry.id, input.timeEntryId))
				.returning();
			// Absence is a claim on the day like any other entry, so the person's
			// rest-of-day block has to give way to it (or take back what a shorter
			// correction frees). Every self-service write already recomputes; the
			// PM's three did not, so a day corrected by a PM stayed
			// over-allocated — an 8h block plus 8h of sick leave on an 8h day.
			await recomputeDayFill(person, existing.date, tz);
			return updated;
		});
	},

	createAbsenceForUser: async (ctx: Ctx, input: CreateAbsenceForUserInput) => {
		const absenceIds = await tasksService.absenceTaskIds();
		if (!absenceIds.has(input.taskId)) {
			throw new Error("Only absence tasks can be logged this way");
		}

		await assertUserInOrg(ctx, input.userId);
		const access = await ctxAccess(ctx);
		const shared = await projectIdsForUser(ctx, input.userId);
		if (!access.canOverrideAbsenceFor(shared)) {
			throw new AccessError("You cannot log absence for this person");
		}

		const tz = await ctxTimezone(ctx);
		return withCtxTx(ctx, async (txCtx) => {
			const person = personCtx(txCtx, input.userId);
			await assertDayHasRoom(person, input.date, input.durationSeconds);
			const [created] = await ctxDb(txCtx)
				.insert(timeEntry)
				.values({
					organizationId: ctx.organizationId,
					userId: input.userId,
					projectId: null,
					taskId: input.taskId,
					date: input.date,
					description: input.description ?? "",
					durationSeconds: input.durationSeconds,
				})
				.returning();
			if (!created) throw new Error("Failed to log absence");
			// The person's day, not the caller's: see `overrideAbsence`.
			await recomputeDayFill(person, input.date, tz);
			return created;
		});
	},

	removeAbsence: async (ctx: Ctx, timeEntryId: string) => {
		const existing = await db.query.timeEntry.findFirst({
			where: and(
				eq(timeEntry.id, timeEntryId),
				eq(timeEntry.organizationId, ctx.organizationId),
			),
			with: { task: true },
		});
		if (!existing) throw new Error("Time entry not found");
		if (!existing.task.isAbsence) {
			throw new Error("Only absence entries can be removed here");
		}

		const access = await ctxAccess(ctx);
		const shared = await projectIdsForUser(ctx, existing.userId);
		if (!access.canOverrideAbsenceFor(shared)) {
			throw new AccessError("You cannot correct this person's absence");
		}

		const tz = await ctxTimezone(ctx);
		await withCtxTx(ctx, async (txCtx) => {
			await ctxDb(txCtx).delete(timeEntry).where(eq(timeEntry.id, timeEntryId));
			// The freed hours go back to the person's rest-of-day block, if the day
			// has one. See `overrideAbsence`.
			await recomputeDayFill(
				personCtx(txCtx, existing.userId),
				existing.date,
				tz,
			);
		});
		return existing;
	},
};
