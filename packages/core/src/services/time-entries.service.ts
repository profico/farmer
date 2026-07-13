import {
	and,
	asc,
	count,
	eq,
	gte,
	inArray,
	isNotNull,
	lt,
	notInArray,
	sql,
} from "drizzle-orm";
import postgres from "postgres";
import { db } from "../db";
import {
	project,
	recurringBlockRuleSkip,
	task,
	timeEntry,
} from "../db/schema/domain";
import { timeEntryGithubCommit } from "../db/schema/github";
import { syncedMeetingTombstone } from "../db/schema/settings";
import { orgTimezone } from "../lib/org-time";
import {
	addDaysToKey,
	anchorDateTime,
	dayBoundsInTz,
	dayKeyInTz,
	secondsBetween,
	timeKeyInTz,
	weekdayInTz,
} from "../lib/time";
import type {
	CopyTimeEntriesInput,
	CreateTimeEntryInput,
	UpdateTimeEntryDescriptionInput,
	UpdateTimeEntryInput,
} from "../schema/time-entries";
import { entryTypesService } from "./entry-types.service";
import { githubService } from "./github.service";
import { googleCalendarService } from "./google-calendar.service";
import { integrationSettingsService } from "./integration-settings.service";
import { projectsService } from "./projects.service";
import { recurringBlockRulesService } from "./recurring-block-rules.service";
import type { Ctx } from "./types";
import {
	dayDurationSeconds,
	type WorkingHoursDay,
	workingHoursService,
} from "./working-hours.service";

// Cross-tenant guard: a projectId/taskId supplied by the client must actually
// belong to the caller's org, or a user in one org could attach a time entry
// to another org's project/task by guessing its id.
// Exported (only the two of these) for time-entries.tenancy.test.ts.
export const assertProjectInOrg = async (ctx: Ctx, projectId: string) => {
	const row = await db.query.project.findFirst({
		where: and(
			eq(project.id, projectId),
			eq(project.organizationId, ctx.organizationId),
		),
	});
	if (!row) throw new Error("Project not found");
};

export const assertTaskBelongsToProject = async (
	ctx: Ctx,
	taskId: string,
	projectId: string,
) => {
	const taskRow = await db.query.task.findFirst({
		where: and(
			eq(task.id, taskId),
			eq(task.projectId, projectId),
			eq(task.organizationId, ctx.organizationId),
		),
	});
	if (!taskRow) throw new Error("Task does not belong to that project");
};

// The day's expected working seconds — the target a fill block expands up to.
const dayFillTargetSeconds = (
	workingHours: WorkingHoursDay[],
	dateKey: string,
	tz: string,
): number => {
	const weekday = weekdayInTz(dateKey, tz);
	const day = workingHours.find((d) => d.dayOfWeek === weekday);
	return day ? dayDurationSeconds(day) : 0;
};

// A db handle or an in-flight db.transaction callback's tx — both expose the
// same query/insert/update surface, so callers that need atomicity (create,
// update) can pass their tx through instead of these helpers reaching for the
// ambient `db` and escaping the transaction.
type DbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// How long a fill block on this day should be: the day's working-hours target
// minus every other (non-fill) entry that day, floored at 0.
// `workingHours`, when passed, skips the per-call working-hours fetch — used
// by callers (e.g. syncCommitWorkTimeForRange) that already loaded it once
// for a whole date range, to avoid an N+1 lookup inside a per-day loop.
const computeDayFillSeconds = async (
	ctx: Ctx,
	dateKey: string,
	tz: string,
	workingHours?: WorkingHoursDay[],
	client: DbClient = db,
): Promise<number> => {
	const { start, end } = dayBoundsInTz(dateKey, tz);
	const [dayEntries, hours] = await Promise.all([
		client.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				gte(timeEntry.startedAt, start),
				lt(timeEntry.startedAt, end),
			),
			columns: { durationSeconds: true, fillsDay: true },
		}),
		workingHours ? Promise.resolve(workingHours) : workingHoursService.list(ctx),
	]);
	const target = dayFillTargetSeconds(hours, dateKey, tz);
	const others = dayEntries
		.filter((e) => !e.fillsDay)
		.reduce((sum, e) => sum + e.durationSeconds, 0);
	return Math.max(0, target - others);
};

// Re-derive the duration of the day's fill block (if one exists) after any of
// its sibling entries changed. No-op when the day has no fill block.
const recomputeDayFill = async (
	ctx: Ctx,
	dateKey: string,
	tz: string,
	client: DbClient = db,
) => {
	const { start, end } = dayBoundsInTz(dateKey, tz);
	const fill = await client.query.timeEntry.findFirst({
		where: and(
			eq(timeEntry.organizationId, ctx.organizationId),
			eq(timeEntry.userId, ctx.userId),
			eq(timeEntry.fillsDay, true),
			gte(timeEntry.startedAt, start),
			lt(timeEntry.startedAt, end),
		),
		columns: { id: true, startedAt: true, durationSeconds: true },
	});
	if (!fill) return;
	const next = await computeDayFillSeconds(ctx, dateKey, tz, undefined, client);
	if (next === fill.durationSeconds) return;
	await client
		.update(timeEntry)
		.set({
			durationSeconds: next,
			stoppedAt: new Date(fill.startedAt.getTime() + next * 1000),
		})
		.where(eq(timeEntry.id, fill.id));
};

// ── Integration write-on-read engines ──────────────────────────────────────
// Both run inside listRange (like the recurring materializer) so opening the
// time page reflects external state without an explicit "sync" click. Each is
// best-effort and idempotent; a failure logs and leaves the page working.

// Reconcile a range against Google Calendar so the user's Meeting blocks mirror
// their calendar: import new events, update ones whose time/title/link changed,
// and delete blocks for events that were cancelled or moved out of the window.
// Google is the source of truth ONLY for sync-owned rows (syncLocked = false);
// a row the user has attached or edited (syncLocked = true) is never overwritten
// or deleted. Tombstones (see remove) keep a user-deleted meeting from being
// re-imported. Idempotent: re-running against an unchanged calendar is a no-op.
const syncMeetingsForRange = async (
	ctx: Ctx,
	range: { from: string; to: string },
) => {
	const events = await googleCalendarService.listEventsForRange(ctx, range);
	// null => couldn't read the calendar (disconnected / revoked token). Bail
	// without deleting, or we'd wipe synced blocks we merely failed to fetch.
	// An empty array is authoritative ("no meetings in range") and DOES reconcile.
	if (events === null) return;

	const types = await entryTypesService.listAvailable(ctx);
	const meetingType = types.find((t) => t.name === "Meeting");
	if (!meetingType) return;

	const tz = await orgTimezone(ctx.organizationId);
	const { start } = dayBoundsInTz(range.from, tz);
	const { end } = dayBoundsInTz(range.to, tz);

	const tombstones = await db.query.syncedMeetingTombstone.findMany({
		where: and(
			eq(syncedMeetingTombstone.organizationId, ctx.organizationId),
			eq(syncedMeetingTombstone.userId, ctx.userId),
		),
		columns: { calendarEventId: true },
	});
	const tombstoned = new Set(tombstones.map((t) => t.calendarEventId));

	// Upsert every live, non-tombstoned event. On conflict we UPDATE the
	// calendar-derived fields, but setWhere restricts that to sync-owned rows, so
	// a user-edited (locked) block keeps its local values untouched.
	const rows = events
		.filter((event) => !tombstoned.has(event.id))
		.map((event) => {
			const startedAt = new Date(event.start);
			const stoppedAt = new Date(event.end);
			return {
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				typeId: meetingType.id,
				description: event.title,
				startedAt,
				stoppedAt,
				durationSeconds: Math.max(0, secondsBetween(startedAt, stoppedAt)),
				meetingUrl: event.meetingUrl,
				calendarEventId: event.id,
				billable: meetingType.billableDefault,
			};
		})
		.filter((row) => row.durationSeconds > 0);
	if (rows.length > 0) {
		await db
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
					startedAt: sql`excluded.started_at`,
					stoppedAt: sql`excluded.stopped_at`,
					durationSeconds: sql`excluded.duration_seconds`,
					meetingUrl: sql`excluded.meeting_url`,
				},
				setWhere: eq(timeEntry.syncLocked, false),
			});
	}

	// Delete-by-absence: any sync-owned meeting block in the window whose event
	// is NOT in the (complete, paginated) live set was cancelled or moved out of
	// range, so it should disappear. Locked (user-owned) rows and non-meeting
	// rows (null calendarEventId — fills, recurring blocks) are left alone.
	//
	// Safety guard: an EMPTY live set is deliberately treated like `null` here
	// (skip deletion) rather than "the calendar has zero meetings in range".
	// Google's calendar API can return an empty page on a throttled request, a
	// partial/expired scope, or a transient API hiccup — none distinguishable
	// from "genuinely no meetings" from here. Wiping every synced block on a
	// false-empty response is unrecoverable data loss, whereas skipping the
	// delete just leaves a stale block until the next successful sync.
	const liveIds = events.map((event) => event.id);
	if (liveIds.length === 0) return;
	const deleteConditions = [
		eq(timeEntry.organizationId, ctx.organizationId),
		eq(timeEntry.userId, ctx.userId),
		eq(timeEntry.syncLocked, false),
		isNotNull(timeEntry.calendarEventId),
		gte(timeEntry.startedAt, start),
		lt(timeEntry.startedAt, end),
		notInArray(timeEntry.calendarEventId, liveIds),
	];
	await db.delete(timeEntry).where(and(...deleteConditions));
};

// For every day the user pushed commits, ensure a Work "rest of day" fill block
// exists so their tracked time auto-expands to that day's working hours (the
// user only has to log meetings/breaks; the work block absorbs the rest). Skips
// days that already have a fill block — the fill's duration is then kept in sync
// on read by listRange's recompute pass.
const syncCommitWorkTimeForRange = async (
	ctx: Ctx,
	range: { from: string; to: string },
	tz: string,
) => {
	const dayKeys = await githubService.listUserCommitDays(ctx, range);
	if (dayKeys.length === 0) return;

	const types = await entryTypesService.listAvailable(ctx);
	const workType = types.find((t) => t.name === "Work");
	if (!workType) return;

	const workingHours = await workingHoursService.list(ctx);
	for (const dayKey of dayKeys) {
		const { start, end } = dayBoundsInTz(dayKey, tz);
		const existingFill = await db.query.timeEntry.findFirst({
			where: and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				eq(timeEntry.fillsDay, true),
				gte(timeEntry.startedAt, start),
				lt(timeEntry.startedAt, end),
			),
			columns: { id: true },
		});
		if (existingFill) continue;

		const weekday = weekdayInTz(dayKey, tz);
		const startTime =
			workingHours.find((d) => d.dayOfWeek === weekday)?.startTime ?? "09:00";
		const startedAt = anchorDateTime(dayKey, startTime, tz);
		// Pass the already-fetched workingHours through so this doesn't re-fetch
		// it once per day in the loop (see computeDayFillSeconds).
		const durationSeconds = await computeDayFillSeconds(
			ctx,
			dayKey,
			tz,
			workingHours,
		);
		await db
			.insert(timeEntry)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				typeId: workType.id,
				description: "",
				startedAt,
				stoppedAt: new Date(startedAt.getTime() + durationSeconds * 1000),
				durationSeconds,
				fillsDay: true,
				fillDate: dayKey,
				billable: workType.billableDefault,
			})
			// The existingFill check above already avoids the common case; this is
			// the DB-enforced backstop against a race with a concurrent create/update
			// (te_fill_day_uidx) — silently skip rather than raise, since this is a
			// best-effort background sync, not a user-initiated write.
			.onConflictDoNothing({
				target: [timeEntry.organizationId, timeEntry.userId, timeEntry.fillDate],
				where: sql`${timeEntry.fillsDay} = true`,
			});
	}
};

export const timeEntriesService = {
	listRange: async (ctx: Ctx, range: { from: string; to: string }) => {
		await recurringBlockRulesService.materializeRange(
			ctx,
			range.from,
			range.to,
		);

		const tz = await orgTimezone(ctx.organizationId);

		// Pull in external state (calendar meetings, commit work-time) before the
		// read, gated on one settings lookup. Best-effort: each engine is isolated
		// so an integration outage degrades to "no sync", never a broken page.
		try {
			const settings = await integrationSettingsService.get(ctx);
			if (settings.googleAutoSyncMeetings) {
				await syncMeetingsForRange(ctx, range).catch((error) =>
					console.error("[time-entries] meeting sync failed", error),
				);
			}
			if (settings.githubSyncCommitsAsWorkTime) {
				await syncCommitWorkTimeForRange(ctx, range, tz).catch((error) =>
					console.error("[time-entries] commit work-time sync failed", error),
				);
			}
		} catch (error) {
			console.error("[time-entries] integration sync skipped", error);
		}

		const { start } = dayBoundsInTz(range.from, tz);
		const { end } = dayBoundsInTz(range.to, tz);

		const rows = await db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				gte(timeEntry.startedAt, start),
				lt(timeEntry.startedAt, end),
			),
			with: { project: true, task: true, type: true },
			orderBy: asc(timeEntry.startedAt),
		});

		// Keep each day's fill block in sync on read (write-on-read, like the
		// recurring materializer above): its duration tracks the day's remaining
		// working hours, so any sibling entry added/removed elsewhere is absorbed.
		const fills = rows.filter((r) => r.fillsDay);
		if (fills.length > 0) {
			const workingHours = await workingHoursService.list(ctx);
			const sumByDay = new Map<string, number>();
			for (const r of rows) {
				if (r.fillsDay) continue;
				const key = dayKeyInTz(r.startedAt, tz);
				sumByDay.set(key, (sumByDay.get(key) ?? 0) + r.durationSeconds);
			}
			for (const fill of fills) {
				const key = dayKeyInTz(fill.startedAt, tz);
				const target = dayFillTargetSeconds(workingHours, key, tz);
				const next = Math.max(0, target - (sumByDay.get(key) ?? 0));
				if (next === fill.durationSeconds) continue;
				const stoppedAt = new Date(fill.startedAt.getTime() + next * 1000);
				await db
					.update(timeEntry)
					.set({ durationSeconds: next, stoppedAt })
					.where(eq(timeEntry.id, fill.id));
				fill.durationSeconds = next;
				fill.stoppedAt = stoppedAt;
			}
		}

		// Attach the count of GitHub commits linked to each entry, so the day view
		// can badge blocks that have work evidence attached (a count query rather
		// than a relation to avoid a domain.ts ↔ github.ts import cycle).
		const commitCountById = new Map<string, number>();
		if (rows.length > 0) {
			const counts = await db
				.select({
					timeEntryId: timeEntryGithubCommit.timeEntryId,
					count: count(),
				})
				.from(timeEntryGithubCommit)
				.where(
					inArray(
						timeEntryGithubCommit.timeEntryId,
						rows.map((r) => r.id),
					),
				)
				.groupBy(timeEntryGithubCommit.timeEntryId);
			for (const c of counts) commitCountById.set(c.timeEntryId, c.count);
		}

		return rows.map((row) => ({
			...row,
			commitCount: commitCountById.get(row.id) ?? 0,
		}));
	},

	// Background-job entrypoint: import a user's Google Calendar meetings for a
	// fixed window, without the rest of listRange's read work (no recurring
	// materialize, no fill recompute). Callers must gate on the user's
	// googleAutoSyncMeetings preference themselves — this runs the same
	// idempotent engine the time page uses on read, so a scheduler tick and a
	// page load converge on the same entries.
	syncMeetingsForUser: async (
		ctx: Ctx,
		range: { from: string; to: string },
	) => {
		await syncMeetingsForRange(ctx, range);
	},

	create: async (ctx: Ctx, input: CreateTimeEntryInput) => {
		const availableTypes = await entryTypesService.listAvailable(ctx, {
			projectId: input.projectId,
		});
		const type = availableTypes.find((t) => t.id === input.typeId);
		if (!type) throw new Error("Entry type not available");

		if (input.projectId) {
			await assertProjectInOrg(ctx, input.projectId);
			await projectsService.assertProjectMembership(ctx, input.projectId);
		}
		if (input.taskId && input.projectId) {
			await assertTaskBelongsToProject(ctx, input.taskId, input.projectId);
		}

		const tz = await orgTimezone(ctx.organizationId);
		const startedAt = anchorDateTime(input.date, input.startTime, tz);

		let stoppedAt: Date;
		let durationSeconds: number;
		if (input.fillsDay) {
			// Only one work-time fill block per user/day; its duration is derived,
			// not entered, and may legitimately be 0 when the day is already full.
			// The DB-level te_fill_day_uidx (fillDate below) is the real guard —
			// this just gives a friendlier error in the common non-racy case.
			durationSeconds = await computeDayFillSeconds(ctx, input.date, tz);
			stoppedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
		} else {
			stoppedAt = anchorDateTime(input.date, input.endTime, tz);
			durationSeconds = secondsBetween(startedAt, stoppedAt);
			if (durationSeconds <= 0) {
				throw new Error("End time must be after start time");
			}
		}

		const values = {
			organizationId: ctx.organizationId,
			userId: ctx.userId,
			projectId: input.projectId,
			taskId: input.taskId,
			typeId: input.typeId,
			description: input.description ?? "",
			startedAt,
			stoppedAt,
			durationSeconds,
			fillsDay: input.fillsDay ?? false,
			// Only stamped for fill rows — backs te_fill_day_uidx (see schema).
			fillDate: input.fillsDay ? input.date : null,
			billable: input.billable ?? type.billableDefault,
			meetingUrl: input.meetingUrl ?? null,
			calendarEventId: input.calendarEventId ?? null,
			// A hand-created entry that attaches a calendar event is user-owned,
			// not sync-owned — lock it so the sync engine never overwrites or
			// deletes it (only rows the engine itself imports stay unlocked).
			syncLocked: input.calendarEventId != null,
		};

		// Insert + fill recompute happen atomically: a crash/error between the two
		// must not leave a fill block stale relative to the entry that just
		// changed its day's totals.
		const created = await db.transaction(async (tx) => {
			let row: typeof timeEntry.$inferSelect | undefined;
			if (input.fillsDay) {
				// The pre-check above (computeDayFillSeconds/duration derivation)
				// only prevents the common case; te_fill_day_uidx is the real,
				// DB-enforced guard against a second fill block racing onto the
				// same day, so a lost race surfaces as a clean, expected error
				// rather than a raw unique-violation 500.
				[row] = await tx
					.insert(timeEntry)
					.values(values)
					.onConflictDoNothing({
						target: [
							timeEntry.organizationId,
							timeEntry.userId,
							timeEntry.fillDate,
						],
						where: sql`${timeEntry.fillsDay} = true`,
					})
					.returning();
				if (!row) {
					throw new Error("A work-time block already exists for this day");
				}
			} else if (input.calendarEventId) {
				// Manually attaching a calendar event that meeting-sync may already
				// have imported would otherwise hit te_calendar_event_uidx and throw
				// a raw 500. Take ownership of the existing synced row instead.
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
							typeId: values.typeId,
							description: values.description,
							startedAt: values.startedAt,
							stoppedAt: values.stoppedAt,
							durationSeconds: values.durationSeconds,
							billable: values.billable,
							meetingUrl: values.meetingUrl,
							syncLocked: true,
						},
					})
					.returning();
			} else {
				[row] = await tx.insert(timeEntry).values(values).returning();
			}
			if (!row) throw new Error("Failed to create time entry");

			// A new normal entry shrinks whatever fill block shares its day.
			if (!input.fillsDay) await recomputeDayFill(ctx, input.date, tz, tx);
			return row;
		});
		return created;
	},

	update: async (ctx: Ctx, input: UpdateTimeEntryInput) => {
		const existing = await db.query.timeEntry.findFirst({
			where: and(
				eq(timeEntry.id, input.timeEntryId),
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
			),
		});
		if (!existing) throw new Error("Time entry not found");

		const availableTypes = await entryTypesService.listAvailable(ctx, {
			projectId: input.projectId,
		});
		if (!availableTypes.some((t) => t.id === input.typeId)) {
			throw new Error("Entry type not available");
		}

		if (input.projectId) {
			await assertProjectInOrg(ctx, input.projectId);
			await projectsService.assertProjectMembership(ctx, input.projectId);
		}
		if (input.taskId && input.projectId) {
			await assertTaskBelongsToProject(ctx, input.taskId, input.projectId);
		}

		const tz = await orgTimezone(ctx.organizationId);
		const startedAt = anchorDateTime(input.date, input.startTime, tz);

		let stoppedAt: Date;
		let durationSeconds: number;
		if (input.fillsDay) {
			// Guard against a second fill block sneaking onto the day via an edit.
			// This only catches the common non-racy case — te_fill_day_uidx (caught
			// below) is the real, DB-enforced guard.
			const { start, end } = dayBoundsInTz(input.date, tz);
			const otherFill = await db.query.timeEntry.findFirst({
				where: and(
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
					eq(timeEntry.fillsDay, true),
					gte(timeEntry.startedAt, start),
					lt(timeEntry.startedAt, end),
				),
				columns: { id: true },
			});
			if (otherFill && otherFill.id !== input.timeEntryId) {
				throw new Error("A work-time block already exists for this day");
			}
			durationSeconds = await computeDayFillSeconds(ctx, input.date, tz);
			stoppedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
		} else {
			stoppedAt = anchorDateTime(input.date, input.endTime, tz);
			durationSeconds = secondsBetween(startedAt, stoppedAt);
			if (durationSeconds <= 0) {
				throw new Error("End time must be after start time");
			}
		}

		// Update + fill recompute (both the entry's old and new day) happen
		// atomically, so a failure partway through never leaves a fill block
		// stale relative to the entry that just moved/resized.
		const updated = await db.transaction(async (tx) => {
			let row: typeof timeEntry.$inferSelect | undefined;
			try {
				[row] = await tx
					.update(timeEntry)
					.set({
						// Full-form edit: an absent project/task means "cleared", not
						// "leave unchanged" (drizzle skips `undefined` values in .set()).
						projectId: input.projectId ?? null,
						taskId: input.taskId ?? null,
						typeId: input.typeId,
						description: input.description ?? "",
						startedAt,
						stoppedAt,
						durationSeconds,
						fillsDay: input.fillsDay ?? false,
						// Only stamped for fill rows — backs te_fill_day_uidx (see schema).
						fillDate: input.fillsDay ? input.date : null,
						billable: input.billable ?? existing.billable,
						// Unlike project/task above, an absent meeting is "leave as-is",
						// not "clear": drizzle skips `undefined` in .set(), so editing an
						// entry's other fields never wipes a previously-attached meeting
						// link. It's only overwritten when the caller re-picks a
						// calendar event.
						meetingUrl: input.meetingUrl,
						calendarEventId: input.calendarEventId,
						// Editing a calendar-linked entry in any way takes it out of the
						// sync engine's hands: Google is the source of truth only until
						// the first local edit, after which the local version wins for
						// good.
						syncLocked:
							existing.calendarEventId != null || input.calendarEventId != null
								? true
								: undefined,
					})
					.where(eq(timeEntry.id, input.timeEntryId))
					.returning();
			} catch (error) {
				// A race with a concurrent create/update lost to te_fill_day_uidx:
				// surface the same friendly error the pre-check above gives in the
				// non-racy case, instead of a raw unique-violation 500.
				if (
					error instanceof postgres.PostgresError &&
					error.code === "23505" &&
					error.constraint_name === "te_fill_day_uidx"
				) {
					throw new Error("A work-time block already exists for this day");
				}
				throw error;
			}

			// The edit may have changed this entry's day and/or duration, so
			// refresh the fill block on both the old and new day.
			const oldDay = dayKeyInTz(existing.startedAt, tz);
			await recomputeDayFill(ctx, input.date, tz, tx);
			if (oldDay !== input.date) await recomputeDayFill(ctx, oldDay, tz, tx);
			return row;
		});
		return updated;
	},

	// Inline note edit: patch the description only. No duration/day change, so
	// no fill recompute is needed. Like any local edit, touching a calendar-linked
	// entry locks it against the sync engine re-importing over the change.
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
			})
			.where(eq(timeEntry.id, input.timeEntryId))
			.returning();
		if (!updated) throw new Error("Failed to update note");
		return updated;
	},

	remove: async (ctx: Ctx, timeEntryId: string) => {
		const deleted = await db.transaction(async (tx) => {
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

			// Deleting an auto-synced meeting must make it "stay deleted": record a
			// tombstone so the meeting-sync engine won't re-import the same calendar
			// event on the next read.
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
			return existing;
		});

		// Deleting a normal entry frees up time the day's fill block reclaims.
		// (If the deleted entry *was* the fill, there's nothing left to recompute.)
		if (deleted && !deleted.fillsDay) {
			const tz = await orgTimezone(ctx.organizationId);
			await recomputeDayFill(ctx, dayKeyInTz(deleted.startedAt, tz), tz);
		}

		// Returned so the caller can offer an "undo" that re-creates the row. The
		// row carries every field (incl. calendarEventId/generatedFromRuleId) the
		// client needs to decide whether undo is safe to offer.
		return deleted ?? null;
	},
};
