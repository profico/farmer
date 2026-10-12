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
	ne,
	or,
	sql,
	type SQL,
} from "drizzle-orm";
import postgres from "postgres";

import { db } from "../db";
import { user } from "../db/schema/auth";
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
import type { AuditChanges } from "../lib/audit";
import {
	automationWriteWindow,
	enabledSinceKey,
} from "../lib/automation-window";
import {
	splitProportionally,
	splitRestOfDay,
	summarizeCommitMessages,
} from "../lib/day-plan";
import { describePullRequestActivity } from "../lib/github-activity";
import {
	addDaysToKey,
	datesBetween,
	dayKeyInTz,
	monthBounds,
	QUARTER_HOUR_SECONDS,
	snapToQuarterHour,
} from "../lib/time";
import { UserFacingError } from "../lib/user-facing-error";
import {
	type HolidayLookup,
	MAX_DAY_SECONDS,
	type WorkingHoursDay,
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
	UpdateTimeEntryDurationInput,
	UpdateTimeEntryInput,
	UseCalendarValuesInput,
} from "../schema/time-entries";
import { AccessError } from "./access.service";
import { diffFields, recordAudit } from "./audit";
import { ctxAccess, ctxDb, ctxTimezone, withCtxTx } from "./context";
import {
	computeDayFillSeconds,
	recomputeDayFill,
	rehomeDroppedFillEvidence,
} from "./day-fill";
import { safeErrorMessage } from "./error-message";
import {
	emitEvent,
	timeEntryWebhookPayload,
	timeEntryWebhookPayloads,
	webhookWants,
} from "./events";
import { filingRulesService, ruleKeyFor } from "./filing-rules.service";
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
import {
	deletedReviewsOnDay,
	isReviewBlock,
	REVIEW_BLOCK_SECONDS,
	refuseReviewBlocks,
	reviewBlockDescription,
	reviewsHeldBy,
	reviewsOnDay,
} from "./pr-reviews";
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
export class DayCapacityError extends UserFacingError {
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

// A calendar-linked row as the meeting engine reads it back.
type SyncedRow = {
	id: string;
	calendarEventId: string;
	date: string;
	description: string;
	durationSeconds: number;
	meetingUrl: string | null;
	syncedDate: string | null;
	syncedDurationSeconds: number | null;
	syncedDescription: string | null;
};

// The face the calendar last gave this row — for matching a reissued event id
// against it. The row's own values would be wrong here twice over: the person
// may have renamed or re-lengthed it, and it is the CALENDAR's old event the
// new one has to look like. A row with no baseline (made by hand around an
// event, or filed before the baseline existed) is matched on what it holds.
const calendarFaceOf = (row: SyncedRow) => ({
	date: row.syncedDate ?? row.date,
	description: row.syncedDescription ?? row.description,
	durationSeconds: row.syncedDurationSeconds ?? row.durationSeconds,
	meetingUrl: row.meetingUrl,
});

// Inside the upsert, per field: is this one about to take a new value from the
// calendar? "The row still says what the calendar last said" AND "the calendar
// now says something else" — the first half is what makes it the calendar's
// field to change at all.
const dateWillChange = sql`(${timeEntry.date} is not distinct from ${timeEntry.syncedDate} and ${timeEntry.date} is distinct from excluded.date)`;
const durationWillChange = sql`(${timeEntry.durationSeconds} is not distinct from ${timeEntry.syncedDurationSeconds} and ${timeEntry.durationSeconds} is distinct from excluded.duration_seconds)`;
const descriptionWillChange = sql`(${timeEntry.description} is not distinct from ${timeEntry.syncedDescription} and ${timeEntry.description} is distinct from excluded.description)`;

const calendarWillChange = sql`(${dateWillChange} or ${durationWillChange} or ${descriptionWillChange})`;

// What the row said, for the fields this write is actually changing, and for
// no others — `jsonb_strip_nulls` drops the rest, so the record IS the list of
// what the calendar moved.
//
// A whole-row snapshot could not carry that, and the screen could not
// reconstruct it: comparing the record against the baseline calls a field the
// person owns moved (the baseline advances under it while the entry keeps
// their value), and comparing it against the entry calls the person's own
// later edit the calendar's doing. Both read as "Moved from Thu" on an entry
// that never left Thursday.
const calendarChangeRecord = sql`jsonb_strip_nulls(jsonb_build_object(
	'date', case when ${dateWillChange} then ${timeEntry.date} else null end,
	'durationSeconds', case when ${durationWillChange} then ${timeEntry.durationSeconds} else null end,
	'description', case when ${descriptionWillChange} then ${timeEntry.description} else null end
))`;

// Does every field the calendar owns by default still say what the calendar
// last said? A field that does is the calendar's; one that differs is the
// person's. A null baseline never matches, which reads as "the person's" —
// the safe side when nothing is known.
const calendarOwnedWhere = and(
	sql`${timeEntry.date} is not distinct from ${timeEntry.syncedDate}`,
	sql`${timeEntry.durationSeconds} is not distinct from ${timeEntry.syncedDurationSeconds}`,
	sql`${timeEntry.description} is not distinct from ${timeEntry.syncedDescription}`,
);

// Reconcile a range against Google Calendar so the user's meeting entries mirror
// their calendar, FIELD BY FIELD. Google owns a meeting's day, length and title
// until the person changes that field in Farmer; project, task and existence-
// after-a-hand-edit are the person's. The `synced*` columns on the row hold what
// the calendar last said, so "has the person changed this?" is one comparison
// per field, made in the upsert itself, and no writer in this file has to know
// which field it is changing. Tombstones keep a user-deleted meeting from
// returning.
//
// This used to be all-or-nothing on `syncLocked`: filing a meeting — the routine
// act, the thing the banner asks for — froze its day and length for good, and a
// meeting moved on the calendar afterwards stayed put with no message (#60).
//
// Under the duration-only entry model a meeting contributes its LENGTH, not its
// slot — an event's start/end are read purely to derive a duration, which is
// then snapped to the 15-minute grid every entry must sit on.
//
// `range` is the window the caller has already decided this engine may touch —
// see lib/automation-window, and note that the delete pass at the bottom reads
// the same `range`, so narrowing the window narrows what can be un-written as
// well as what can be written.
const syncMeetingsForRange = async (
	ctx: Ctx,
	range: { from: string; to: string },
	tz: string,
) => {
	const calendar = calendarSource();
	const events = await calendar.listEventsForRange(ctx, range);
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
	// filingRulesService.resolve.
	const filingRules = await filingRulesService.resolve(ctx, [meetingTask.id]);

	const tombstones = await db.query.syncedMeetingTombstone.findMany({
		where: and(
			eq(syncedMeetingTombstone.organizationId, ctx.organizationId),
			eq(syncedMeetingTombstone.userId, ctx.userId),
		),
		columns: { calendarEventId: true },
	});
	const tombstoned = new Set(tombstones.map((t) => t.calendarEventId));

	// Every calendar-linked row on a day this engine may write to, whoever owns
	// it. Read once, before anything moves: the day a meeting LEAVES has to be
	// recomputed too, and after the upsert that date is gone from every row.
	const existing: SyncedRow[] = (
		await db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				isNotNull(timeEntry.calendarEventId),
				gte(timeEntry.date, range.from),
				lte(timeEntry.date, range.to),
			),
			columns: {
				id: true,
				calendarEventId: true,
				date: true,
				description: true,
				durationSeconds: true,
				meetingUrl: true,
				syncedDate: true,
				syncedDurationSeconds: true,
				syncedDescription: true,
			},
		})
	).flatMap((row) =>
		row.calendarEventId
			? [{ ...row, calendarEventId: row.calendarEventId }]
			: [],
	);

	const liveIds = new Set(events.map((event) => event.id));

	// Rows whose event is not in the list. "Not in the list" is not yet "gone":
	// Google returns an empty page on a throttled request, the list is capped,
	// and a meeting moved to next week is simply outside `range`. Each is asked
	// about by id, and only a definite answer is acted on. A row that turns out
	// to still be live inside the window joins the write below as if the list
	// had carried it; one that is gone, or now sits on a day outside the window,
	// is removed below — unless the person has edited it, in which case it is
	// their record of a meeting and not the calendar's to take back.
	//
	// Asked in one batch: the case this pass exists for is the empty or
	// throttled list, where EVERY synced row in the window is stale at once.
	const stale = existing.filter((row) => !liveIds.has(row.calendarEventId));
	const lookups = await calendar.lookupEvents(
		ctx,
		stale.map((row) => row.calendarEventId),
	);
	const confirmedLive: typeof events = [];
	const removable: SyncedRow[] = [];
	// Row id → event id, for the rows whose event Google says is GONE, as
	// against merely outside the window. The two retire a row alike and part
	// company at the tombstone below.
	const vanished = new Map<string, string>();
	for (const row of stale) {
		const lookup = lookups.get(row.calendarEventId);
		if (!lookup || lookup.status === "unreadable") continue;
		if (lookup.status === "found") {
			const date = dayKeyInTz(new Date(lookup.event.start), tz);
			if (date >= range.from && date <= range.to) {
				confirmedLive.push(lookup.event);
				continue;
			}
		} else {
			vanished.set(row.id, row.calendarEventId);
		}
		removable.push(row);
	}

	const rows = [...events, ...confirmedLive]
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
			const rule = filingRules.get(ruleKeyFor(meetingTask.id, event.title));
			const date = dayKeyInTz(startedAt, tz);
			const durationSeconds = snapToQuarterHour(rawSeconds);
			return {
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				// A synced meeting has no project by default: it's the user's job to
				// file it against one, and it lands as a project-less draft they can
				// complete. A filing rule is the person having already answered that
				// question for this meeting, so the occurrence arrives filed.
				//
				// The row stays syncLocked = false either way. The rule decides where
				// the time goes, not who owns the row. Taking ownership is what filing
				// BY HAND means (see `file`), and that is a different act from having
				// pre-answered where it goes.
				//
				// A rule may also name the task (a design review is not a Meeting to
				// the person billing it). The upsert below never rewrites the task or
				// the project of a row that exists, so this lands on the first write.
				projectId: rule?.projectId ?? null,
				taskId: rule?.taskId ?? meetingTask.id,
				description: event.title,
				date,
				durationSeconds,
				meetingUrl: event.meetingUrl,
				calendarEventId: event.id,
				meetingStartsAt: startedAt,
				// What the calendar says now, so the next pass can tell the person's
				// edits from the calendar's.
				syncedDate: date,
				syncedDurationSeconds: durationSeconds,
				syncedDescription: event.title,
			};
		})
		// Only days this engine may write to. `range` is the automation window, and
		// Google's `timeMin` matches on overlap, not on start: an event that began
		// the evening before `range.from` comes back too, dated by its start — a
		// day the lock or the grace window has already closed.
		.filter((row) => row.date >= range.from && row.date <= range.to);

	// REISSUED event ids. Google mints new instance ids when a recurring series
	// is edited with "this and following", and a cancelled-and-recreated meeting
	// is a new event outright. The old id is then gone from the calendar and a
	// new one sits on the same day with the same face. Rather than importing the
	// new id next to the old row and retiring the old row — which throws away
	// the project the person filed it to and anything they typed — the old row
	// is pointed at the new id, and the write below then treats it as that
	// event's row.
	//
	// Only a row whose own event has VANISHED is a candidate. Two different
	// half-hour "1:1"s on the same day both stay in the list, so neither can
	// claim the other's row — the old rule matched on the face alone and let a
	// filed meeting swallow its same-shaped neighbour.
	const orphans = new Map<string, SyncedRow>();
	for (const row of removable) {
		for (const key of meetingIdentityKeys(calendarFaceOf(row))) {
			if (!orphans.has(key)) orphans.set(key, row);
		}
	}

	// An incoming id that some row ALREADY holds is not free to point anything
	// at. `existing` stops at the window, so a row on a day this engine may not
	// write to is invisible to it — and repointing an orphan at that row's
	// event id hits `te_calendar_event_uidx` and takes the whole meeting pass
	// down with it. It is the wrong answer on its own terms too: the event has
	// a row, it just sits on a day nothing here may move.
	const claimed = new Set<string>();
	if (rows.length > 0) {
		const held = await db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				inArray(
					timeEntry.calendarEventId,
					rows.map((row) => row.calendarEventId),
				),
			),
			columns: { calendarEventId: true },
		});
		for (const row of held) {
			if (row.calendarEventId) claimed.add(row.calendarEventId);
		}
	}

	const repointed = new Set<string>();
	for (const row of rows) {
		if (claimed.has(row.calendarEventId)) continue;
		const holder = meetingIdentityKeys(row)
			.map((key) => orphans.get(key))
			.find((candidate) => candidate && !repointed.has(candidate.id));
		if (!holder) continue;
		await db
			.update(timeEntry)
			.set({ calendarEventId: row.calendarEventId })
			.where(eq(timeEntry.id, holder.id));
		repointed.add(holder.id);
		claimed.add(row.calendarEventId);
		console.info("[time-entries] re-linked a reissued calendar event", {
			previousEventId: holder.calendarEventId,
			eventId: row.calendarEventId,
			date: row.date,
		});
	}

	// Days whose fill block may now be the wrong length. Collected rather than
	// derived at the end, because by then the moves have already happened and the
	// day a meeting LEFT is no longer nameable from anything in hand.
	const touched = new Set<string>();

	if (rows.length > 0) {
		// Where these events sit BEFORE the write moves them. A meeting dragged
		// from Monday to Tuesday gives Monday its quarter-hour back, and the block
		// that has to absorb it is on the day the meeting is leaving.
		const incoming = new Set(rows.map((row) => row.calendarEventId));
		for (const row of existing) {
			if (incoming.has(row.calendarEventId) || repointed.has(row.id)) {
				touched.add(row.date);
			}
		}

		// The three-way merge, per field: the row keeps the person's value where
		// it no longer equals what the calendar last said, and takes the
		// calendar's new value where it does. `is not distinct from` so a null
		// baseline compares as "different", i.e. the person's. The baseline itself
		// always advances to what the calendar says now. Project and task are
		// never in the SET: they are the person's from the first write.
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
					date: sql`case when ${timeEntry.date} is not distinct from ${timeEntry.syncedDate} then excluded.date else ${timeEntry.date} end`,
					durationSeconds: sql`case when ${timeEntry.durationSeconds} is not distinct from ${timeEntry.syncedDurationSeconds} then excluded.duration_seconds else ${timeEntry.durationSeconds} end`,
					description: sql`case when ${timeEntry.description} is not distinct from ${timeEntry.syncedDescription} then excluded.description else ${timeEntry.description} end`,
					// The join link is the calendar's outright: nothing in the app edits
					// it on a synced row, and a stale link is worse than none.
					meetingUrl: sql`excluded.meeting_url`,
					meetingStartsAt: sql`excluded.meeting_starts_at`,
					// Stamp the change and keep what the row said, when a field the
					// calendar still owns is about to take a different value. A field the
					// person owns is not changing, so it is not a change to report.
					calendarChangedAt: sql`case when ${calendarWillChange} then now() else ${timeEntry.calendarChangedAt} end`,
					calendarChangeFrom: sql`case when ${calendarWillChange} then ${calendarChangeRecord} else ${timeEntry.calendarChangeFrom} end`,
					syncedDate: sql`excluded.synced_date`,
					syncedDurationSeconds: sql`excluded.synced_duration_seconds`,
					syncedDescription: sql`excluded.synced_description`,
				},
				// The existing row's date, not the incoming one: a meeting already
				// synced onto a locked or out-of-window day is history, and moving it
				// out is a write to that day as surely as adding to it. Without this, a
				// stand-up on the 28th that was moved to the 2nd left August, and the
				// fill recompute then grew August's rest-of-day block back by its
				// length — hours added to a month already closed.
				setWhere: and(
					gte(timeEntry.date, range.from),
					lte(timeEntry.date, range.to),
				),
			})
			// What actually landed. A conflict the `setWhere` declined returns
			// nothing, so its day is not touched either.
			.returning({ date: timeEntry.date });
		for (const row of written) touched.add(row.date);
	}

	// What Google has confirmed is gone from this window — cancelled, or moved
	// to a day the engine may not write to. A filed meeting with nothing typed
	// into it is still the calendar's record of the day, and comes off the sheet
	// as it would have before it was filed. One with a hand-set day, length or
	// note is the person's record that a meeting happened, and stays — as their
	// own entry from here on, no longer linked to an event that no longer says
	// what the entry says. Left linked, the row would pin the event id, so a
	// meeting moved to next week could never be written on next week's day
	// (its row would sit on a closed day the upsert may not move), and every
	// pass would ask Google about it again.
	const gone = removable
		.filter((row) => !repointed.has(row.id))
		.map((row) => row.id);
	if (gone.length > 0) {
		const removed = await db
			.delete(timeEntry)
			.where(
				and(
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
					inArray(timeEntry.id, gone),
					calendarOwnedWhere,
				),
			)
			.returning({ date: timeEntry.date });
		for (const row of removed) touched.add(row.date);
		const unlinked = await db
			.update(timeEntry)
			.set({
				calendarEventId: null,
				meetingStartsAt: null,
				calendarChangedAt: null,
				calendarChangeFrom: null,
				syncedDate: null,
				syncedDurationSeconds: null,
				syncedDescription: null,
			})
			.where(
				and(
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
					inArray(timeEntry.id, gone),
				),
			)
			.returning({ id: timeEntry.id });

		// A kept row is no longer linked, so nothing ties it to the event any
		// more — and that is the whole difference between the two reasons a row
		// is retired. A meeting merely moved OUT OF THE WINDOW is meant to be
		// written again on its new day, which is why the link had to go. One
		// Google calls gone can only come back as the same event restored on the
		// same day, and that would import a second entry beside the person's own
		// record of the same meeting. The tombstone is what "nothing touches it
		// again" means; deliberately re-creating an entry for the event lifts it,
		// the same as for a meeting deleted by hand (see `create`).
		const staysGone = unlinked.flatMap(({ id }) => {
			const calendarEventId = vanished.get(id);
			return calendarEventId
				? [
						{
							organizationId: ctx.organizationId,
							userId: ctx.userId,
							calendarEventId,
						},
					]
				: [];
		});
		if (staysGone.length > 0) {
			await db
				.insert(syncedMeetingTombstone)
				.values(staysGone)
				.onConflictDoNothing();
		}
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
 * May the rest-of-day block be filed against this project?
 *
 * A repo is linked to exactly one project org-wide (pgr_org_repo_unq), so the
 * evidence of one repo names one project and there is no guess to make. Two
 * gates decide whether the engine may write project time there at all.
 *
 * Both gates answer false rather than throw. This runs inside a background
 * sweep over everybody, and a task that the org archived is a configuration
 * answer, not a failure.
 */
const canFileFillOn = async (
	ctx: Ctx,
	workTaskId: string,
	projectId: string,
): Promise<boolean> => {
	// Belt and braces: `reposForUser` already inner-joins an active projectMember
	// row, so a commit cannot reach here on a project the person isn't on. Kept
	// because this writes billable project time and that invariant lives three
	// files away — the memo makes it free.
	const access = await ctxAccess(ctx);
	if (!access.canTrackOn(projectId)) return false;

	// The task must be live and not an absence task. No project has a task subset
	// any more, so this fails only for an archived task, but writing an entry the
	// person could not have created by hand is exactly what assertTaskAvailable
	// exists to prevent.
	try {
		await assertTaskAvailable(ctx, workTaskId, projectId);
	} catch {
		return false;
	}
	return true;
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

type DayEntryRow = {
	id: string;
	description: string;
	projectId: string | null;
	fillsDay: boolean;
};

const dayEntryColumns = {
	id: timeEntry.id,
	description: timeEntry.description,
	projectId: timeEntry.projectId,
	fillsDay: timeEntry.fillsDay,
};

/** How much one project's evidence weighs in a split: its commits plus its
 *  distinct pull requests, by repo and number. This is Assemble my day's count,
 *  so the two split a day the same way; an opened and a merged event on one pull
 *  request are one pull request. */
const evidenceWeight = (group: DayEvidence): number =>
	group.commits.length +
	new Set(
		group.pullRequests.map((pr) => `${pr.projectGithubRepoId}|${pr.number}`),
	).size;

/** The projects that may take part of the rest-of-day block, each with the
 *  weight of its evidence. */
const weighEligibleProjects = async (
	ctx: Ctx,
	workTaskId: string,
	projectIds: string[],
	evidenceByProject: Map<string, DayEvidence>,
): Promise<{ projectId: string; weight: number }[]> => {
	const eligible: { projectId: string; weight: number }[] = [];
	for (const projectId of projectIds) {
		if (!(await canFileFillOn(ctx, workTaskId, projectId))) continue;
		eligible.push({
			projectId,
			weight: evidenceWeight(
				evidenceByProject.get(projectId) ?? emptyEvidence(),
			),
		});
	}
	return eligible;
};

type DayWeights = { projectId: string; weight: number }[];

type CarveInput = {
	workTaskId: string;
	dayKey: string;
	fill: DayEntryRow & { projectId: string };
	newcomers: DayWeights;
	evidenceByProject: Map<string, DayEvidence>;
};

const holdsAttached = (
	evidence: DayEvidence | undefined,
	attached: Set<string>,
): boolean =>
	!!evidence &&
	(evidence.commits.some((c) => attached.has(`c|${c.sha}`)) ||
		evidence.pullRequests.some((a) =>
			attached.has(`p|${a.projectGithubRepoId}|${a.number}`),
		));

/**
 * What a carve-out would write, or null when it would write nothing. Reads
 * only, through `client`, so the caller can ask without opening a transaction
 * and ask again under the lock.
 *
 * The fill's project is weighed by the evidence already on the fill plus this
 * run's, and by at least 1: a fill with no evidence (made by hand, or from
 * Assemble my day) is still the person's block on that project, and weight 0
 * would hand the newcomer the whole of it or, as `splitProportionally` does,
 * nothing at all. The newcomers weigh by theirs. The fill's CURRENT length is
 * divided by `splitProportionally`; a newcomer whose share is 0 gets nothing.
 */
const planCarve = async (
	client: ReturnType<typeof ctxDb>,
	ctx: Ctx,
	input: CarveInput,
): Promise<{
	carved: { projectId: string; seconds: number }[];
	fillSeconds: number;
} | null> => {
	const { fill } = input;
	const [current] = await client
		.select({ durationSeconds: timeEntry.durationSeconds })
		.from(timeEntry)
		.where(eq(timeEntry.id, fill.id));
	if (!current) return null;
	const taken = await client
		.select({ projectId: timeEntry.projectId })
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				eq(timeEntry.date, input.dayKey),
				eq(timeEntry.taskId, input.workTaskId),
				eq(timeEntry.fillsDay, false),
				inArray(
					timeEntry.projectId,
					input.newcomers.map((p) => p.projectId),
				),
			),
		);
	const owned = new Set(taken.map((row) => row.projectId));
	const open = input.newcomers.filter((p) => !owned.has(p.projectId));
	if (open.length === 0) return null;
	const [commitRows, activityRows] = await Promise.all([
		client
			.select({ sha: timeEntryGithubCommit.sha })
			.from(timeEntryGithubCommit)
			.where(eq(timeEntryGithubCommit.timeEntryId, fill.id)),
		client
			.select({
				projectGithubRepoId: timeEntryGithubPrActivity.projectGithubRepoId,
				number: timeEntryGithubPrActivity.number,
			})
			.from(timeEntryGithubPrActivity)
			.where(eq(timeEntryGithubPrActivity.timeEntryId, fill.id)),
	]);
	// A project whose evidence already sits on the fill is not late: the person
	// moved the fill to another project, and the commits went with it. Carving
	// it an entry would put the same commits on two entries.
	const attached = new Set([
		...commitRows.map((c) => `c|${c.sha}`),
		...activityRows.map((a) => `p|${a.projectGithubRepoId}|${a.number}`),
	]);
	const newcomers = open.filter(
		(p) => !holdsAttached(input.evidenceByProject.get(p.projectId), attached),
	);
	if (newcomers.length === 0) return null;
	// Distinct, so a rerun that sees the same commit again does not weigh it
	// twice: what is on the fill and what this run found overlap.
	const own = input.evidenceByProject.get(fill.projectId) ?? emptyEvidence();
	const keys = new Set([
		...commitRows.map((c) => `c|${c.sha}`),
		...own.commits.map((c) => `c|${c.sha}`),
		...activityRows.map((a) => `p|${a.projectGithubRepoId}|${a.number}`),
		...own.pullRequests.map((a) => `p|${a.projectGithubRepoId}|${a.number}`),
	]);
	const shares = splitProportionally(current.durationSeconds, [
		Math.max(1, keys.size),
		...newcomers.map((p) => p.weight),
	]);
	if ((shares[0] ?? 0) <= 0) return null;
	const carved = newcomers
		.map((p, index) => ({
			projectId: p.projectId,
			seconds: shares[index + 1] ?? 0,
		}))
		.filter((p) => p.seconds > 0);
	if (carved.length === 0) return null;
	const carvedSeconds = carved.reduce((sum, p) => sum + p.seconds, 0);
	return { carved, fillSeconds: current.durationSeconds - carvedSeconds };
};

/**
 * Evidence for a project that has no entry on the day, after the day's fill
 * block was filed against ANOTHER project (an earlier run saw only that one).
 * Carve each such project a plain Development entry out of the fill, so late
 * evidence is not dropped for good.
 *
 * Planned first, without a transaction: a day that cannot settle (no share, no
 * newcomer left) must not lock the fill on every sweep. A transaction opens
 * only when a write will follow, and plans again under the lock. Both writes
 * land together, so a reader never sees the fill shrunk without the new entry.
 */
const carveFromFill = async (
	ctx: Ctx,
	input: CarveInput,
): Promise<DayEntryRow[]> => {
	if (!(await planCarve(ctxDb(ctx), ctx, input))) return [];
	return withCtxTx(ctx, async (txCtx) => {
		const tx = ctxDb(txCtx);
		// Belt and braces: the sweep and "Sync now" share a per-person guard, so
		// no second run is expected here. The lock and the re-plan make the
		// carve-out correct without relying on that guard.
		await tx
			.select({ id: timeEntry.id })
			.from(timeEntry)
			.where(eq(timeEntry.id, input.fill.id))
			.for("update");
		const plan = await planCarve(tx, ctx, input);
		if (!plan) return [];
		const entries = await tx
			.insert(timeEntry)
			.values(
				plan.carved.map((p) => ({
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					taskId: input.workTaskId,
					projectId: p.projectId,
					description:
						describeEvidence(
							input.evidenceByProject.get(p.projectId) ?? emptyEvidence(),
						) || "Rest of day",
					date: input.dayKey,
					durationSeconds: p.seconds,
					fillsDay: false,
				})),
			)
			.returning(dayEntryColumns);
		await tx
			.update(timeEntry)
			.set({ durationSeconds: plan.fillSeconds, updatedAt: new Date() })
			.where(eq(timeEntry.id, input.fill.id));
		return entries;
	});
};

const carveLateProjects = async (
	ctx: Ctx,
	input: {
		workTaskId: string;
		dayKey: string;
		fill: DayEntryRow & { projectId: string };
		homelessProjectIds: string[];
		evidenceByProject: Map<string, DayEvidence>;
	},
): Promise<DayEntryRow[]> => {
	const others = input.homelessProjectIds.filter(
		(id) => id !== input.fill.projectId,
	);
	const eligible = await weighEligibleProjects(
		ctx,
		input.workTaskId,
		others,
		input.evidenceByProject,
	);
	// A project with only placed reviews has nothing to attach and no weight.
	const newcomers = eligible.filter((p) => p.weight > 0);
	if (newcomers.length === 0) return [];
	return carveFromFill(ctx, { ...input, newcomers });
};

/**
 * File the day's rest-of-day block for evidence that found no home, split by
 * project when the evidence names more than one.
 *
 * The day is sized once, from what it holds. Every project the person may file
 * Development on shares it in the ratio Assemble my day uses (commits and
 * unplaced pull request events), through `splitRestOfDay`. The largest share is
 * the fill block, so the day still resizes through `recomputeDayFill`; every
 * other share is a plain Development entry. A project the person cannot track
 * on gets no share. With no project left
 * the block is project-less, as it was before the split, and holds everything.
 *
 * Only the fill is elastic. The plain split entries keep their length when the
 * person later logs more time that day: `recomputeDayFill` shrinks the fill,
 * never them, and the fill is deleted when nothing is left.
 *
 * Returns what exists on the day afterwards. `fill` is null when the day is
 * full or the person deleted the block (the tombstone).
 */
const fileRestOfDay = async (
	ctx: Ctx,
	input: {
		workTaskId: string;
		dayKey: string;
		tz: string;
		day: { workingHours: WorkingHoursDay[]; holidays: HolidayLookup };
		homelessProjectIds: string[];
		evidenceByProject: Map<string, DayEvidence>;
		tombstones: CommitTombstones;
	},
): Promise<{ fill: DayEntryRow | null; split: DayEntryRow[] }> => {
	const { dayKey, workTaskId } = input;
	// A day already accounted for in full gets no block. Inserting a 0-second one
	// would just park an empty second "Development" row next to the entries that
	// already filled the day. The attach pass still runs, which is the point of
	// separating the two jobs.
	const durationSeconds = await computeDayFillSeconds(
		ctx,
		dayKey,
		input.tz,
		input.day,
	);
	if (durationSeconds <= 0 || input.tombstones.day) {
		return { fill: null, split: [] };
	}

	// A project the person deleted a block for on this day gets no share, and is
	// not "ineligible" either: with nothing but such projects left there is no
	// block, rather than a project-less one that would take their evidence.
	const asked = input.homelessProjectIds.filter(
		(id) => !input.tombstones.projects.has(id),
	);
	if (asked.length === 0) return { fill: null, split: [] };
	const evidenceByProject = new Map(
		[...input.evidenceByProject].filter(
			([id]) => !input.tombstones.projects.has(id),
		),
	);
	const eligible = await weighEligibleProjects(
		ctx,
		workTaskId,
		asked,
		evidenceByProject,
	);
	// A day of reviews only: every review went to a block of its own, so there is
	// no evidence to weigh, and the projects share the day equally.
	if (eligible.every((p) => p.weight === 0)) {
		for (const p of eligible) p.weight = 1;
	}
	const plan =
		eligible.length > 0
			? splitRestOfDay(durationSeconds, eligible)
			: [{ projectId: null, seconds: durationSeconds }];

	const describe = (projectId: string | null) =>
		describeEvidence(
			projectId
				? (evidenceByProject.get(projectId) ?? emptyEvidence())
				: mergeEvidence([...evidenceByProject.values()]),
		) || "Rest of day";
	const values = (entry: { projectId: string | null; seconds: number }) => ({
		organizationId: ctx.organizationId,
		userId: ctx.userId,
		taskId: workTaskId,
		projectId: entry.projectId,
		description: describe(entry.projectId),
		date: dayKey,
		durationSeconds: entry.seconds,
	});

	const [owner, ...rest] = plan;
	if (!owner) return { fill: null, split: [] };
	// One transaction: a reader (a concurrent `listRange`) must not see the fill
	// without its siblings, and a failed sibling must not leave the fill sized
	// for a day it no longer holds.
	return withCtxTx(ctx, async (txCtx) => {
		const tx = ctxDb(txCtx);
		const [created] = await tx
			.insert(timeEntry)
			.values({ ...values(owner), fillsDay: true })
			// te_fill_day_uidx is the real guard against a second fill block on the
			// day; silently skip rather than raise, since this is a best-effort
			// background sync, not a user-initiated write. It also covers the race with
			// a concurrent "Sync now".
			.onConflictDoNothing({
				target: [timeEntry.organizationId, timeEntry.userId, timeEntry.date],
				where: sql`${timeEntry.fillsDay} = true`,
			})
			.returning(dayEntryColumns);
		if (!created) {
			// Something else filed the day's fill block between the read and this
			// insert. Attach to theirs, and leave the split to whoever owns the day.
			const theirs = await tx.query.timeEntry.findFirst({
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
			});
			return { fill: theirs ?? null, split: [] };
		}
		const split =
			rest.length > 0
				? await tx
						.insert(timeEntry)
						.values(
							rest.map((entry) => ({ ...values(entry), fillsDay: false })),
						)
						.returning(dayEntryColumns)
				: [];
		return { fill: created, split };
	});
};

/**
 * File each pull request the person reviewed on the day as a Code Review block
 * of its own, and attach its reviews there. Returns the review events it
 * placed, so the rest of the pass leaves them out of the day's work evidence.
 *
 * A PR's reviews go, best home first, to:
 *
 *   1. the entry that already holds this PR's reviews on the day — the block a
 *      previous run filed, or whatever a run before review blocks attached them
 *      to, so a day already filed is not given a second half hour;
 *   2. a Code Review entry on that project the person logged themselves, which
 *      is their own answer to how long the reviewing took;
 *   3. a new block of `REVIEW_BLOCK_SECONDS` — or down to a quarter hour when
 *      the day has less free time than that — if the person may track on the
 *      project and has not deleted this block before.
 *
 * A review that finds none of these is not placed. The engine then treats it
 * as the evidence it always was, which is what a full day or a deleted block
 * should get.
 *
 * No unique index guards against a second block for the same PR: the sweep and
 * "Sync now" share one per-person guard, so this never runs twice at once for
 * the same person, and step 1 finds the block on every later run.
 */
const fileReviewBlocks = async (
	ctx: Ctx,
	dayKey: string,
	tz: string,
	reviewTaskId: string,
	reviews: ScannedPullRequestActivity[],
	day: { workingHours: WorkingHoursDay[]; holidays: HolidayLookup },
): Promise<{ placed: Set<string>; created: boolean }> => {
	const placed = new Set<string>();
	if (reviews.length === 0) return { placed, created: false };

	const byPullRequest = new Map<string, ScannedPullRequestActivity[]>();
	for (const review of reviews) {
		byPullRequest.set(review.pullRequestUrl, [
			...(byPullRequest.get(review.pullRequestUrl) ?? []),
			review,
		]);
	}

	const [{ homes, heldBy }, deleted, reviewEntries, access] = await Promise.all(
		[
			reviewsOnDay(ctx, dayKey),
			deletedReviewsOnDay(ctx, dayKey),
			db.query.timeEntry.findMany({
				where: and(
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
					eq(timeEntry.date, dayKey),
					eq(timeEntry.taskId, reviewTaskId),
					eq(timeEntry.fillsDay, false),
				),
				columns: { id: true, projectId: true, description: true },
				orderBy: [asc(timeEntry.createdAt)],
			}),
			ctxAccess(ctx),
		],
	);

	// Step 2's candidates: every Code Review entry that is not one PR's block.
	// Every PR reviewed on its project goes on it, including after the first —
	// a hand-logged entry that already holds #10 is still the home for #11.
	const handLogged = new Map<string, (typeof reviewEntries)[number]>();
	for (const entry of reviewEntries) {
		if (entry.projectId === null) continue;
		if (isReviewBlock(entry.description, heldBy.get(entry.id) ?? [])) continue;
		if (!handLogged.has(entry.projectId)) {
			handLogged.set(entry.projectId, entry);
		}
	}

	// The same two gates as `canFileFillOn`: this writes project time.
	const verdicts = new Map<string, boolean>();
	const mayFileOn = async (projectId: string) => {
		const cached = verdicts.get(projectId);
		if (cached !== undefined) return cached;
		let allowed = access.canTrackOn(projectId);
		if (allowed) {
			try {
				await assertTaskAvailable(ctx, reviewTaskId, projectId);
			} catch {
				allowed = false;
			}
		}
		verdicts.set(projectId, allowed);
		return allowed;
	};

	let room = await computeDayFillSeconds(ctx, dayKey, tz, day);
	let created = false;
	const attachments = new Map<string, ScannedPullRequestActivity[]>();
	for (const [pullRequestUrl, events] of byPullRequest) {
		const [first] = events;
		if (!first) continue;
		let target =
			homes.get(pullRequestUrl) ?? handLogged.get(first.projectId)?.id ?? null;
		const size = Math.min(
			REVIEW_BLOCK_SECONDS,
			room - (room % QUARTER_HOUR_SECONDS),
		);
		if (
			!target &&
			size > 0 &&
			!deleted.has(pullRequestUrl) &&
			(await mayFileOn(first.projectId))
		) {
			const [row] = await db
				.insert(timeEntry)
				.values({
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					taskId: reviewTaskId,
					projectId: first.projectId,
					description: reviewBlockDescription(first.title),
					date: dayKey,
					durationSeconds: size,
				})
				.returning({ id: timeEntry.id });
			if (row) {
				target = row.id;
				room -= size;
				created = true;
			}
		}
		if (!target) continue;
		attachments.set(target, [...(attachments.get(target) ?? []), ...events]);
		for (const event of events) placed.add(event.eventId);
	}

	// A hand-logged entry with no description gets one, as the work entries do.
	for (const entry of handLogged.values()) {
		const events = attachments.get(entry.id);
		if (!events || entry.description.trim() !== "") continue;
		await db
			.update(timeEntry)
			.set({
				description: summarizeCommitMessages(
					describePullRequestActivity(events),
				),
				updatedAt: new Date(),
			})
			.where(eq(timeEntry.id, entry.id));
	}

	const rows = [...attachments].flatMap(([timeEntryId, events]) =>
		events.map((event) =>
			pullRequestActivityRow(timeEntryId, event.projectGithubRepoId, event),
		),
	);
	if (rows.length > 0) {
		await db
			.insert(timeEntryGithubPrActivity)
			.values(rows)
			// tegpa_entry_event_unq: a re-run attaches the same reviews again.
			.onConflictDoNothing();
	}
	return { placed, created };
};

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
	// Optional. Without it, reviews stay evidence on the day's work.
	const reviewTask = await tasksService.findBySystemKey(ctx, "code_review");

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

		// Review blocks first. Each takes its time from the day's free time, so it
		// has to exist before the rest-of-day block is sized, or resized.
		let placed = new Set<string>();
		if (reviewTask) {
			const filed = await fileReviewBlocks(
				ctx,
				dayKey,
				tz,
				reviewTask.id,
				pullRequests.filter((event) => event.kind === "reviewed"),
				{ workingHours, holidays },
			);
			placed = filed.placed;
			if (filed.created) await recomputeDayFill(ctx, dayKey, tz);
		}

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
		// A placed review sits on its own block, so it is not evidence for a work
		// entry. It still says the day was worked, so its project still counts
		// towards the rest-of-day block below.
		const reviewedProjectIds = new Set<string>();
		for (const event of pullRequests) {
			if (placed.has(event.eventId)) reviewedProjectIds.add(event.projectId);
			else evidenceFor(event.projectId).pullRequests.push(event);
		}

		const homelessProjectIds = [
			...new Set([...evidenceByProject.keys(), ...reviewedProjectIds]),
		].filter((projectId) => !byProject.has(projectId));

		// The fill block is created only for evidence that found no home — a day
		// of reviews is a worked day as surely as a day of commits — and only if
		// the day still has room and nobody has said no.
		// Only evidence that found no home can meet a no.
		const tombstones =
			homelessProjectIds.length > 0
				? await commitTombstonesOn(ctx, dayKey)
				: { day: false, projects: new Set<string>() };
		const splitEntries = new Map<string, DayEntryRow>();
		const fillPredates = fill !== null;
		if (homelessProjectIds.length > 0 && !fill && !generalEntry) {
			const filed = await fileRestOfDay(ctx, {
				workTaskId: workTask.id,
				dayKey,
				tz,
				day: { workingHours, holidays },
				homelessProjectIds,
				evidenceByProject,
				tombstones,
			});
			fill = filed.fill;
			for (const entry of filed.split) {
				if (entry.projectId) splitEntries.set(entry.projectId, entry);
			}
		}

		// Late evidence: an earlier run filed the fill against one project and this
		// run sees another. Carve the newcomer its own entry out of the fill.
		// A fill filed in this very run already split the day among everything it
		// saw, so only a fill from an earlier run can be late for a newcomer.
		if (fillPredates && fill?.projectId && !generalEntry && !tombstones.day) {
			const carved = await carveLateProjects(ctx, {
				workTaskId: workTask.id,
				dayKey,
				fill: { ...fill, projectId: fill.projectId },
				homelessProjectIds: homelessProjectIds.filter(
					(id) => !tombstones.projects.has(id),
				),
				evidenceByProject,
			});
			for (const entry of carved) {
				if (entry.projectId) splitEntries.set(entry.projectId, entry);
			}
		}

		// Where each project's evidence goes, best home first. Null means the day
		// has nothing to attach to for that project — a full day with no work entry
		// on it, or a fill block filed against ANOTHER project — and the evidence is
		// simply left for a later run, once there is.
		//
		// A fallback may only be project-less or on the evidence's own project. A
		// fill block belongs to the project it was filed against; hanging a second
		// project's commits on it would bill that project for the other's work.
		const fallbacks = [fill, generalEntry];
		const attachments = new Map<string, DayEvidence>();
		for (const [projectId, group] of evidenceByProject) {
			// A project the person deleted its block for stays unattached, unless
			// it has an entry again.
			if (tombstones.projects.has(projectId) && !byProject.has(projectId)) {
				continue;
			}
			const target =
				byProject.get(projectId) ??
				splitEntries.get(projectId) ??
				fallbacks.find(
					(entry) =>
						entry &&
						(entry.projectId === null || entry.projectId === projectId),
				);
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

/** Does this entry hold commits or pull request events of a Development block?
 *  Read before a delete, because the attachments cascade with the row. A Code
 *  Review block holds pull request events too, and has a tombstone of its own. */
const holdsCommitEvidence = async (
	ctx: Ctx,
	timeEntryId: string,
): Promise<boolean> => {
	const tx = ctxDb(ctx);
	const [row] = await tx
		.select({ systemKey: task.systemKey })
		.from(timeEntry)
		.innerJoin(task, eq(task.id, timeEntry.taskId))
		.where(
			and(
				eq(timeEntry.id, timeEntryId),
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
			),
		);
	if (row?.systemKey !== "development") return false;
	const [commit] = await tx
		.select({ id: timeEntryGithubCommit.id })
		.from(timeEntryGithubCommit)
		.where(eq(timeEntryGithubCommit.timeEntryId, timeEntryId))
		.limit(1);
	if (commit) return true;
	const [activity] = await tx
		.select({ id: timeEntryGithubPrActivity.id })
		.from(timeEntryGithubPrActivity)
		.where(eq(timeEntryGithubPrActivity.timeEntryId, timeEntryId))
		.limit(1);
	return !!activity;
};

/** Record the person's no to the commit engine for a day: a project's block, or
 *  with no project the whole day. */
const tombstoneCommitBlock = async (
	ctx: Ctx,
	date: string,
	projectId: string | null,
) => {
	await ctxDb(ctx)
		.insert(commitFillTombstone)
		.values({
			organizationId: ctx.organizationId,
			userId: ctx.userId,
			date,
			projectId,
		})
		.onConflictDoNothing();
};

/** Take back the person's no to the commit engine after a deliberate create.
 *  See the comment at the call site in `create`. */
const retractCommitTombstones = async (
	tx: ReturnType<typeof ctxDb>,
	ctx: Ctx,
	entry: {
		date: string;
		projectId: string | null;
		fillsDay: boolean;
		development: boolean;
	},
) => {
	const rows: SQL[] = [];
	if (entry.fillsDay) rows.push(isNull(commitFillTombstone.projectId));
	if (entry.projectId && (entry.fillsDay || entry.development)) {
		rows.push(eq(commitFillTombstone.projectId, entry.projectId));
	}
	if (rows.length === 0) return;
	await tx
		.delete(commitFillTombstone)
		.where(
			and(
				eq(commitFillTombstone.organizationId, ctx.organizationId),
				eq(commitFillTombstone.userId, ctx.userId),
				eq(commitFillTombstone.date, entry.date),
				or(...rows),
			),
		);
};

/** What this person has told the commit engine no to on a day. See the table
 *  comment in db/schema/settings.ts. `day` is the old, day-level no (a
 *  project-less fill block was deleted); `projects` are the projects whose block
 *  or evidence-holding entry was deleted. */
type CommitTombstones = { day: boolean; projects: Set<string> };

const commitTombstonesOn = async (
	ctx: Ctx,
	dateKey: string,
): Promise<CommitTombstones> => {
	const rows = await db.query.commitFillTombstone.findMany({
		where: and(
			eq(commitFillTombstone.organizationId, ctx.organizationId),
			eq(commitFillTombstone.userId, ctx.userId),
			eq(commitFillTombstone.date, dateKey),
		),
		columns: { projectId: true },
	});
	const projects = new Set<string>();
	for (const row of rows) if (row.projectId) projects.add(row.projectId);
	return { day: rows.some((row) => row.projectId === null), projects };
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

/** One audit row for a PM's absence write on ANOTHER person's day. Written
 *  through the caller's own Ctx (the PM is the actor), never `personCtx`. A
 *  person's own absence is their own time and is not recorded. */
const recordAbsenceForPerson = async (
	ctx: Ctx,
	entry: {
		kind:
			| "absence.logged_for_person"
			| "absence.changed_for_person"
			| "absence.removed_for_person";
		personUserId: string;
		date: string;
		taskName: string;
		durationSeconds: number;
		changes?: AuditChanges;
	},
) => {
	if (entry.personUserId === ctx.userId) return;
	const [person] = await ctxDb(ctx)
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, entry.personUserId))
		.limit(1);
	await recordAudit(ctx, {
		kind: entry.kind,
		target: {
			type: "member",
			id: entry.personUserId,
			label: person?.name ?? null,
		},
		subjectUserId: entry.personUserId,
		changes: entry.changes ?? null,
		details: {
			date: entry.date,
			task: entry.taskName,
			durationSeconds: entry.durationSeconds,
		},
	});
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
			// The id breaks a createdAt tie, which `copy day` and the automation
			// engines make routinely by inserting a day's rows in one statement.
			// Without it Postgres is free to answer two identical queries in two
			// orders, and the CLI's row numbers ("farmer edit 3") name whichever
			// row came back third that time.
			orderBy: [
				asc(timeEntry.date),
				asc(timeEntry.createdAt),
				asc(timeEntry.id),
			],
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

	/** One of the caller's OWN entries with the joins a REST answer names — its
	 *  task, its project and that project's client — plus its commit count, or
	 *  undefined.
	 *
	 *  For `POST` and `PATCH /api/v1/orgs/$slug/time-entries`, which answer with
	 *  the entry as `listRange` shows it. `create` and `update` return the bare
	 *  row, and re-reading the day through `listRange` instead would answer a
	 *  write with another write, since that read recomputes fill blocks. */
	getOwnDetailed: async (ctx: Ctx, timeEntryId: string) => {
		const row = await db.query.timeEntry.findFirst({
			where: and(
				eq(timeEntry.id, timeEntryId),
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
			),
			with: { project: { with: { client: true } }, task: true },
		});
		if (!row) return undefined;
		const [commits] = await db
			.select({ count: count() })
			.from(timeEntryGithubCommit)
			.where(eq(timeEntryGithubCommit.timeEntryId, row.id));
		return { ...row, commitCount: commits?.count ?? 0 };
	},

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

			// Deliberately asking for a rest-of-day block, or for Development time on
			// a project, retracts an earlier "no". Without this, deleting the block
			// once would suppress the engine there forever, including after the
			// person changed their mind and made one by hand (or accepted it in
			// Assemble my day) — a tombstone outliving the decision it recorded. A
			// fill, with a project or without, clears the day-level no. A fill or a
			// Development entry on a project clears that project's. Any other entry
			// clears nothing.
			await retractCommitTombstones(tx, ctx, {
				date: input.date,
				projectId: input.projectId ?? null,
				fillsDay: !!input.fillsDay,
				development: taskRow.systemKey === "development",
			});

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

			// In the transaction, so the entry and the record that it happened
			// commit together. Costs nothing unless somebody is subscribed — see
			// `services/events.ts`.
			const createdId = row.id;
			await emitEvent(
				txCtx,
				taskRow.isAbsence ? "absence.created" : "time_entry.created",
				() => timeEntryWebhookPayload(txCtx, createdId),
			);
			return row;
		});
	},

	update: async (ctx: Ctx, input: UpdateTimeEntryInput) => {
		const existing = await ctxDb(ctx).query.timeEntry.findFirst({
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

		// Commits and pull request events are evidence of work on the day they
		// happened. An entry holding them stays on that day: moved, it would
		// claim the work for a day it was not done on. Asked here rather than in
		// the dialog alone, so the CLI and the MCP tools meet the same rule.
		if (input.date !== existing.date) {
			const [commit, pullRequestEvent] = await Promise.all([
				ctxDb(ctx).query.timeEntryGithubCommit.findFirst({
					where: eq(timeEntryGithubCommit.timeEntryId, existing.id),
					columns: { id: true },
				}),
				ctxDb(ctx).query.timeEntryGithubPrActivity.findFirst({
					where: eq(timeEntryGithubPrActivity.timeEntryId, existing.id),
					columns: { id: true },
				}),
			]);
			if (commit || pullRequestEvent) {
				throw new Error(
					"This entry holds GitHub commits or pull request events, so it stays on the day they happened",
				);
			}
		}

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

		// A day holds one fill block (`te_fill_day_uidx`). Asked before the write,
		// as `create` asks it, because the index answers with a driver error that
		// the web app and the REST API can only report as a server failure.
		if (input.fillsDay) {
			const otherFill = await ctxDb(ctx).query.timeEntry.findFirst({
				where: and(
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
					eq(timeEntry.date, input.date),
					eq(timeEntry.fillsDay, true),
					ne(timeEntry.id, input.timeEntryId),
				),
				columns: { id: true },
			});
			if (otherFill) {
				throw new Error("A work-time block already exists for this day");
			}
		}

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
				// The check above covers the ordinary case; this covers a fill block
				// written between that check and this update. drizzle-orm wraps a
				// failed query in `DrizzleQueryError` and keeps the driver's error in
				// `cause`, so the constraint is read there, not on `error`.
				const cause = error instanceof Error ? error.cause : undefined;
				if (
					cause instanceof postgres.PostgresError &&
					cause.code === "23505" &&
					cause.constraint_name === "te_fill_day_uidx"
				) {
					throw new Error("A work-time block already exists for this day");
				}
				throw error;
			}

			await recomputeDayFill(txCtx, input.date, tz);
			if (existing.date !== input.date) {
				await recomputeDayFill(txCtx, existing.date, tz);
			}
			const updatedId = row?.id;
			if (updatedId) {
				await emitEvent(txCtx, "time_entry.updated", () =>
					timeEntryWebhookPayload(txCtx, updatedId),
				);
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
	 * recompute. The task changes only when one is given.
	 *
	 * Returns the row as filed, plus the task it had before, which is what a
	 * filing rule is keyed on.
	 */
	file: async (ctx: Ctx, input: FileTimeEntryInput) => {
		const existing = await db.query.timeEntry.findFirst({
			where: and(
				eq(timeEntry.id, input.timeEntryId),
				eq(timeEntry.organizationId, ctx.organizationId),
				// Filing is self-service: nobody else attributes your time for you.
				eq(timeEntry.userId, ctx.userId),
			),
			columns: {
				id: true,
				taskId: true,
				calendarEventId: true,
				description: true,
				fillsDay: true,
			},
		});
		if (!existing) throw new Error("Time entry not found");

		await assertProjectInOrg(ctx, input.projectId);
		const access = await ctxAccess(ctx);
		access.assertCanTrackOn(input.projectId);
		// The task still has to be one that may go on a project, exactly as if the
		// entry had been created against that project by hand.
		const taskId = input.taskId ?? existing.taskId;
		const taskRow = await assertTaskAvailable(ctx, taskId, input.projectId);
		// A new task brings its own note rule. The entry's own task was already
		// held to it when the entry was written.
		if (taskId !== existing.taskId) {
			assertDescribed(taskRow, existing.description, {
				fillsDay: existing.fillsDay,
			});
		}

		const [updated] = await db
			.update(timeEntry)
			.set({
				projectId: input.projectId,
				taskId,
				// Filing a synced meeting is the user taking ownership of it; without
				// this the next sync would treat it as its own row again.
				syncLocked: existing.calendarEventId != null ? true : undefined,
				updatedAt: new Date(),
			})
			.where(eq(timeEntry.id, input.timeEntryId))
			.returning();
		if (!updated) throw new Error("Failed to file entry");
		// Filing changes an entry's project, which is the field a receiver most
		// often keys on — so it is an update, not a second creation.
		await emitEvent(ctx, "time_entry.updated", () =>
			timeEntryWebhookPayload(ctx, updated.id),
		);
		return { ...updated, filedFromTaskId: existing.taskId };
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
		const succeeded: {
			timeEntryId: string;
			taskId: string;
			description: string;
		}[] = [];
		for (const timeEntryId of input.timeEntryIds) {
			try {
				const entry = await timeEntriesService.file(ctx, {
					timeEntryId,
					projectId: input.projectId,
					taskId: input.taskId,
				});
				succeeded.push({
					timeEntryId: entry.id,
					// The key is the task the sync wrote, not the one filed under.
					taskId: entry.filedFromTaskId,
					description: entry.description ?? "",
				});
				filed++;
			} catch (error) {
				// `firstError` reaches the REST API, the CLI, the MCP server and the
				// assistant's model provider, so only a message written for a person
				// may pass. A database error carries its SQL and parameters.
				const message = error instanceof Error ? safeErrorMessage(error) : null;
				if (message === null) {
					console.error("[time-entries] could not file an entry", {
						organizationId: ctx.organizationId,
						timeEntryId,
						error,
					});
				}
				reasons.push(message ?? "Could not file entry");
			}
		}

		// Best-effort, and deliberately after the filing rather than alongside it:
		// the hours are the write that matters and they are already committed, so a
		// preference that fails to save must not turn a successful filing into an
		// error toast. `remembered` is reported instead, and it is 0 when nothing
		// carried a title worth keying on.
		//
		let remembered = 0;
		if (input.remember && succeeded.length > 0) {
			try {
				remembered = await filingRulesService.rememberFrom(
					ctx,
					{ projectId: input.projectId, targetTaskId: input.taskId },
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
		await emitEvent(ctx, "time_entry.updated", () =>
			timeEntryWebhookPayload(ctx, updated.id),
		);
		return updated;
	},

	/**
	 * Patch an entry's length and nothing else — the row's inline duration box.
	 *
	 * Narrower than `update` on the same grounds as `file` and
	 * `updateDescription`: correcting an hour must not make the caller resupply
	 * the project, task and date. It still owes the day the two things a length
	 * change owes it, which is why this is not `updateDescription` with a
	 * different column — the 24-hour ceiling, and the fill block, which is sized
	 * from what the rest of the day holds and so is wrong the moment any entry
	 * beside it grows or shrinks.
	 */
	updateDuration: async (ctx: Ctx, input: UpdateTimeEntryDurationInput) => {
		const existing = await db.query.timeEntry.findFirst({
			where: and(
				eq(timeEntry.id, input.timeEntryId),
				eq(timeEntry.organizationId, ctx.organizationId),
				// Own entries only, as every other manual write here. A PM does not
				// correct somebody else's worked time.
				eq(timeEntry.userId, ctx.userId),
			),
			columns: {
				id: true,
				date: true,
				fillsDay: true,
				calendarEventId: true,
			},
		});
		if (!existing) throw new Error("Time entry not found");

		// A fill block claims the rest of the working day, so its length is
		// derived rather than entered — `recomputeDayFill` below would overwrite
		// anything typed here on the same tick. Refused rather than ignored, so
		// the box does not appear to accept a number it then discards.
		if (existing.fillsDay) {
			throw new Error(
				"A work-time block's length comes from the day's remaining hours",
			);
		}

		const tz = await ctxTimezone(ctx);
		return withCtxTx(ctx, async (txCtx) => {
			await assertDayHasRoom(txCtx, existing.date, input.durationSeconds, {
				replacing: (row) => row.id === existing.id,
			});
			const [updated] = await ctxDb(txCtx)
				.update(timeEntry)
				.set({
					durationSeconds: input.durationSeconds,
					// Re-length a synced meeting by hand and it is yours: Google stops
					// being the source of truth for it, exactly as editing its note or
					// opening the dialog on it does.
					syncLocked: existing.calendarEventId != null ? true : undefined,
					updatedAt: new Date(),
				})
				.where(eq(timeEntry.id, input.timeEntryId))
				.returning();
			if (!updated) throw new Error("Failed to update duration");

			await recomputeDayFill(txCtx, existing.date, tz);
			await emitEvent(txCtx, "time_entry.updated", () =>
				timeEntryWebhookPayload(txCtx, updated.id),
			);
			return updated;
		});
	},

	/**
	 * Put a synced meeting back on the calendar's day and length.
	 *
	 * The other half of field ownership (see `syncMeetingsForRange`): once the
	 * person has changed a meeting's day or length, the sync leaves that field
	 * alone for good, and the row shows what the calendar says instead. This is
	 * the one click that takes the calendar's values back — it sets the fields
	 * equal to the recorded baseline, which is exactly the state in which the
	 * next sync treats them as the calendar's again. The note is not touched:
	 * a note is the person's from the moment they write one.
	 *
	 * A manual write, so it owes the day what `update` owes it: the 24-hour
	 * ceiling on the day it lands on, the fill blocks of both days, and the rule
	 * that an entry holding commits stays on the day they were made.
	 */
	useCalendarValues: async (ctx: Ctx, input: UseCalendarValuesInput) => {
		const existing = await db.query.timeEntry.findFirst({
			where: and(
				eq(timeEntry.id, input.timeEntryId),
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
			),
			columns: {
				id: true,
				date: true,
				durationSeconds: true,
				calendarEventId: true,
				syncedDate: true,
				syncedDurationSeconds: true,
			},
		});
		if (!existing) throw new Error("Time entry not found");
		if (
			existing.calendarEventId == null ||
			existing.syncedDate == null ||
			existing.syncedDurationSeconds == null
		) {
			throw new Error("This entry is not linked to a calendar meeting");
		}
		const date = existing.syncedDate;
		const durationSeconds = existing.syncedDurationSeconds;
		if (
			date === existing.date &&
			durationSeconds === existing.durationSeconds
		) {
			return existing;
		}

		if (date !== existing.date) {
			const [commit, pullRequestEvent] = await Promise.all([
				db.query.timeEntryGithubCommit.findFirst({
					where: eq(timeEntryGithubCommit.timeEntryId, existing.id),
					columns: { id: true },
				}),
				db.query.timeEntryGithubPrActivity.findFirst({
					where: eq(timeEntryGithubPrActivity.timeEntryId, existing.id),
					columns: { id: true },
				}),
			]);
			if (commit || pullRequestEvent) {
				throw new Error(
					"This entry holds commits or pull requests from its day and cannot move",
				);
			}
		}

		const tz = await ctxTimezone(ctx);
		return withCtxTx(ctx, async (txCtx) => {
			await assertDayHasRoom(txCtx, date, durationSeconds, {
				replacing: (row) => row.id === existing.id,
			});
			const [updated] = await ctxDb(txCtx)
				.update(timeEntry)
				.set({ date, durationSeconds, updatedAt: new Date() })
				.where(eq(timeEntry.id, existing.id))
				.returning();
			if (!updated) throw new Error("Failed to update the entry");

			await recomputeDayFill(txCtx, existing.date, tz);
			if (date !== existing.date) await recomputeDayFill(txCtx, date, tz);
			await emitEvent(txCtx, "time_entry.updated", () =>
				timeEntryWebhookPayload(txCtx, updated.id),
			);
			return updated;
		});
	},

	/** Dismiss the row's "updated by calendar" notice. Nothing else changes. */
	acknowledgeCalendarChange: async (
		ctx: Ctx,
		input: UseCalendarValuesInput,
	) => {
		const [updated] = await db
			.update(timeEntry)
			.set({ calendarChangedAt: null, calendarChangeFrom: null })
			.where(
				and(
					eq(timeEntry.id, input.timeEntryId),
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
				),
			)
			.returning({ id: timeEntry.id });
		if (!updated) throw new Error("Time entry not found");
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
		await emitEvent(ctx, "time_entry.updated", () =>
			timeEntryWebhookPayload(ctx, updated.id),
		);
		return updated;
	},

	remove: async (ctx: Ctx, timeEntryId: string) => {
		return withCtxTx(ctx, async (txCtx) => {
			const tx = ctxDb(txCtx);
			// Before the delete: the attachments cascade with the row.
			const heldReviews = await reviewsHeldBy(txCtx, timeEntryId);
			const holdsEvidence = await holdsCommitEvidence(txCtx, timeEntryId);
			// Also before the delete, and for the same reason: a webhook payload is
			// a projection over this row's joins, and there is nothing left to
			// project from once it is gone. Read only when somebody asked for one
			// of the two kinds a delete can be.
			const wanted =
				(await webhookWants(txCtx, "time_entry.deleted")) ||
				(await webhookWants(txCtx, "absence.removed"));
			const deleted = wanted
				? await timeEntryWebhookPayload(txCtx, timeEntryId)
				: null;
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
				// The day-level row says no to the whole rest of the day, so a late
				// push for another project does not file a new block. A fill on a
				// project also leaves that project's row, which keeps its evidence
				// off the entries that remain.
				await tombstoneCommitBlock(txCtx, existing.date, null);
				if (existing.projectId) {
					await tombstoneCommitBlock(txCtx, existing.date, existing.projectId);
				}
			} else if (existing?.projectId && holdsEvidence) {
				// A split entry, or any Development entry the engine put commits on:
				// the same no, for that project.
				await tombstoneCommitBlock(txCtx, existing.date, existing.projectId);
			}

			// And a review block. What told the engine this PR's block exists was
			// its attached reviews, which just went with the row. A review taken
			// off the block before the delete left its own tombstone then (see
			// `githubService.detachPullRequestActivity`).
			if (existing) {
				await refuseReviewBlocks(txCtx, existing.date, heldReviews);
			}
			// Inside the transaction: the deletion and the fill block it resizes
			// have to land together, or a reader between the two sees a day whose
			// fill has not yet absorbed the freed time.
			if (existing && !existing.fillsDay) {
				const tz = await ctxTimezone(txCtx);
				await recomputeDayFill(txCtx, existing.date, tz);
			}

			if (existing && deleted) {
				await emitEvent(
					txCtx,
					deleted.entry.task.isAbsence
						? "absence.removed"
						: "time_entry.deleted",
					() => deleted,
				);
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

	/** Copy a day's entries onto another day. The backfill affordance for a
	 *  repeating week: most people work a similar shape most days.
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

			// One event per row, not one per copy: a receiver reconciles entries,
			// and a batch shape would be a second payload for every kind to handle.
			// A copied week is about forty of them (issue #67, question 1).
			const copiedIds: string[] = [];
			if (permitted.length > 0) {
				const rows = await tx
					.insert(timeEntry)
					.values(
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
					)
					.returning({ id: timeEntry.id });
				copiedIds.push(...rows.map((row) => row.id));
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

			// The fill block is deliberately not among them: it is the automation's
			// row, sized from what the day has left, and the engines do not emit.
			// See the header of `services/events.ts`.
			if (copiedIds.length > 0) {
				const payloads = await timeEntryWebhookPayloads(txCtx, copiedIds);
				for (const payload of payloads) {
					await emitEvent(
						txCtx,
						payload.entry.task.isAbsence
							? "absence.created"
							: "time_entry.created",
						() => payload,
					);
				}
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
				// `reason` reaches the REST API, the CLI and the `log_absence` tool.
				const message = error instanceof Error ? safeErrorMessage(error) : null;
				if (message === null) {
					console.error("[time-entries] could not log an absence day", {
						organizationId: ctx.organizationId,
						date,
						error,
					});
				}
				skipped.push({ date, reason: message ?? "could not be logged" });
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
			if (updated) {
				await emitEvent(txCtx, "time_entry.updated", () =>
					timeEntryWebhookPayload(txCtx, updated.id),
				);
				const changes = diffFields(
					{
						durationSeconds: existing.durationSeconds,
						description: existing.description,
					},
					{
						durationSeconds: updated.durationSeconds,
						description: updated.description,
					},
					["durationSeconds", "description"],
				);
				if (changes) {
					await recordAbsenceForPerson(txCtx, {
						kind: "absence.changed_for_person",
						personUserId: existing.userId,
						date: existing.date,
						taskName: existing.task.name,
						durationSeconds: updated.durationSeconds,
						changes,
					});
				}
			}
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
			await emitEvent(txCtx, "absence.created", () =>
				timeEntryWebhookPayload(txCtx, created.id),
			);
			const [absenceTask] = await ctxDb(txCtx)
				.select({ name: task.name })
				.from(task)
				.where(eq(task.id, input.taskId))
				.limit(1);
			await recordAbsenceForPerson(txCtx, {
				kind: "absence.logged_for_person",
				personUserId: input.userId,
				date: input.date,
				taskName: absenceTask?.name ?? "",
				durationSeconds: input.durationSeconds,
			});
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
			// Projected before the delete — see `remove`.
			const removed = (await webhookWants(txCtx, "absence.removed"))
				? await timeEntryWebhookPayload(txCtx, timeEntryId)
				: null;
			await ctxDb(txCtx).delete(timeEntry).where(eq(timeEntry.id, timeEntryId));
			if (removed) {
				await emitEvent(txCtx, "absence.removed", () => removed);
			}
			// The freed hours go back to the person's rest-of-day block, if the day
			// has one. See `overrideAbsence`.
			await recomputeDayFill(
				personCtx(txCtx, existing.userId),
				existing.date,
				tz,
			);
			await recordAbsenceForPerson(txCtx, {
				kind: "absence.removed_for_person",
				personUserId: existing.userId,
				date: existing.date,
				taskName: existing.task.name,
				durationSeconds: existing.durationSeconds,
			});
		});
		return existing;
	},
};
