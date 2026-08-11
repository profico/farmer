import {
	and,
	asc,
	count,
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
import { timeEntryGithubCommit } from "../db/schema/github";
import { syncedMeetingTombstone } from "../db/schema/settings";
import { summarizeCommitMessages } from "../lib/day-plan";
import { clampToMeetingSyncWindow } from "../lib/meeting-window";
import {
	addDaysToKey,
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
	CopyTimeEntriesInput,
	CopyWeekEntriesInput,
	CreateAbsenceForUserInput,
	CreateTimeEntryInput,
	FileTimeEntriesInput,
	FileTimeEntryInput,
	ListAbsenceForUserInput,
	OverrideAbsenceEntryInput,
	SetTimeEntryOvertimeInput,
	SetWeekCellInput,
	UpdateTimeEntryDescriptionInput,
	UpdateTimeEntryInput,
} from "../schema/time-entries";
import { ctxAccess, ctxDb, ctxTimezone, withCtxTx } from "./context";
import { assertProjectInOrg, assertTaskAvailable } from "./guards";
import { integrationSettingsService } from "./integration-settings.service";
import { calendarSource, commitSource } from "./ports";
import { recurringBlockRulesService } from "./recurring-block-rules.service";
import { tasksService } from "./tasks.service";
import type { Ctx } from "./types";
import {
	type WorkingHoursDay,
	workingHoursService,
} from "./working-hours.service";

// How long a fill block on this day should be: the day's working-hours target
// minus every other (non-fill) entry that day, floored at 0. The rules are in
// lib/working-day; this only fetches what they need.
//
// Reads through `ctxDb(ctx)` rather than taking a client parameter: inside
// `withCtxTx` that IS the transaction, so a caller cannot accidentally recompute
// a day on the ambient pool after its own transaction has committed — which is
// exactly what remove, setWeekCell and copyDay used to do.
const computeDayFillSeconds = async (
	ctx: Ctx,
	dateKey: string,
	tz: string,
	workingHours?: WorkingHoursDay[],
	/** Entry to leave out of the claims — the one being converted INTO the fill
	 *  block, which would otherwise be counted as competing with itself. */
	excludeEntryId?: string,
): Promise<number> => {
	const [dayEntries, hours] = await Promise.all([
		ctxDb(ctx).query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				eq(timeEntry.date, dateKey),
			),
			columns: { id: true, durationSeconds: true, fillsDay: true },
		}),
		workingHours
			? Promise.resolve(workingHours)
			: workingHoursService.list(ctx),
	]);
	return remainingSeconds(
		targetSecondsFor(hours, dateKey, tz),
		spokenForSeconds(dayEntries.filter((e) => e.id !== excludeEntryId)),
	);
};

// Re-derive the duration of the day's fill block (if any) after a sibling entry
// changed. No-op when the day has no fill block.
//
// A fill block that recomputes to ZERO is DELETED, not stored at 0. The day's
// working hours are already spoken for, so what it now describes is "nothing" —
// and `remainingSeconds` floors at 0, so the row can never come back on its own
// while the day stays full. Keeping it left a literal `0:00 — rest of day` row
// sitting in the Day view after any bulk write that filled the day (copyDay,
// day assembly), which is what people reported as "it adds items with 0 time".
// The DB CHECK still permits `fills_day = true and duration_seconds >= 0`; this
// is the layer that decides a zero-length block is not worth keeping.
const recomputeDayFill = async (ctx: Ctx, dateKey: string, tz: string) => {
	const client = ctxDb(ctx);
	const fill = await client.query.timeEntry.findFirst({
		where: and(
			eq(timeEntry.organizationId, ctx.organizationId),
			eq(timeEntry.userId, ctx.userId),
			eq(timeEntry.date, dateKey),
			eq(timeEntry.fillsDay, true),
		),
		columns: { id: true, durationSeconds: true },
	});
	if (!fill) return;
	const next = await computeDayFillSeconds(ctx, dateKey, tz);
	if (next === 0) {
		await client.delete(timeEntry).where(eq(timeEntry.id, fill.id));
		return;
	}
	if (next === fill.durationSeconds) return;
	await client
		.update(timeEntry)
		.set({ durationSeconds: next, updatedAt: new Date() })
		.where(eq(timeEntry.id, fill.id));
};

// ── Integration write-on-read engines ──────────────────────────────────────
// Both run inside listRange (like the recurring materializer) so opening the
// time page reflects external state without an explicit "sync" click. Each is
// best-effort and idempotent; a failure logs and leaves the page working.

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
			const rawSeconds = Math.floor(
				(stoppedAt.getTime() - startedAt.getTime()) / 1000,
			);
			return {
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				taskId: meetingTask.id,
				// A synced meeting has no project: it's the user's job to file it
				// against one. It lands as a project-less draft they can complete.
				projectId: null,
				description: event.title,
				date: dayKeyInTz(startedAt, tz),
				durationSeconds: snapToQuarterHour(rawSeconds),
				meetingUrl: event.meetingUrl,
				calendarEventId: event.id,
			};
		})
		.filter((row) => row.durationSeconds > 0)
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
					date: sql`excluded.date`,
					durationSeconds: sql`excluded.duration_seconds`,
					meetingUrl: sql`excluded.meeting_url`,
				},
				setWhere: eq(timeEntry.syncLocked, false),
			});
	}

	// Delete-by-absence. An EMPTY live set is deliberately treated like `null`
	// (skip deletion): Google can return an empty page on a throttled request or
	// a partial scope, and wiping every synced entry on a false empty is
	// unrecoverable, whereas skipping just leaves a stale row until next sync.
	const liveIds = events.map((event) => event.id);
	if (liveIds.length === 0) return;
	await db
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
		);
};

// For every day the user pushed commits, ensure a "rest of day" fill block
// exists so tracked time auto-expands to that day's working hours — the user
// only logs meetings and breaks, the fill absorbs the remainder. The commits
// themselves ride along: they name the block and attach to it as evidence, so
// the entry can answer "what was this?" without the person retyping it.
const syncCommitWorkTimeForRange = async (
	ctx: Ctx,
	range: { from: string; to: string },
	tz: string,
) => {
	const days = await commitSource().listUserCommitsByDay(ctx, range);
	if (days.length === 0) return;

	// Resolved by system key, not by display name. The old lookup matched
	// `name = 'Development'` scoped to the org, so an org that renamed the task
	// (or one seeded before the key existed) had this engine silently switched
	// off — no block, no error.
	const workTask = await tasksService.findBySystemKey(ctx, "development");
	if (!workTask) return;

	const workingHours = await workingHoursService.list(ctx);
	for (const { dayKey, commits } of days) {
		const durationSeconds = await computeDayFillSeconds(
			ctx,
			dayKey,
			tz,
			workingHours,
		);
		// A day already accounted for in full gets no block. Inserting a 0-second
		// one would just park an empty second "Development" row next to the entries
		// that already filled the day.
		if (durationSeconds <= 0) continue;

		const description = summarizeCommitMessages(commits.map((c) => c.message));

		const [created] = await db
			.insert(timeEntry)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				taskId: workTask.id,
				projectId: null,
				description,
				date: dayKey,
				durationSeconds,
				fillsDay: true,
			})
			// te_fill_day_uidx is the real guard against a second fill block on the
			// day; silently skip rather than raise, since this is a best-effort
			// background sync, not a user-initiated write.
			.onConflictDoNothing({
				target: [timeEntry.organizationId, timeEntry.userId, timeEntry.date],
				where: sql`${timeEntry.fillsDay} = true`,
			})
			.returning();

		// Nothing returned => the day already had a fill block: this engine's, from
		// an earlier run, or one the person made by hand. Either way today's
		// commits belong on it.
		const entry =
			created ??
			(await db.query.timeEntry.findFirst({
				where: and(
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
					eq(timeEntry.date, dayKey),
					eq(timeEntry.fillsDay, true),
				),
				columns: { id: true, description: true },
			}));
		if (!entry) continue;

		// Only ever fill a blank description — a person's own wording outranks
		// generated commit subjects, and this runs on every read.
		if (!created && entry.description.trim() === "" && description) {
			await db
				.update(timeEntry)
				.set({ description, updatedAt: new Date() })
				.where(eq(timeEntry.id, entry.id));
		}

		await db
			.insert(timeEntryGithubCommit)
			.values(
				commits.map((commit) => ({
					timeEntryId: entry.id,
					projectGithubRepoId: commit.projectGithubRepoId,
					sha: commit.sha,
					message: commit.message,
					authorLogin: commit.authorLogin,
					committedAt: commit.committedAt,
					url: commit.url,
				})),
			)
			// tegc_entry_sha_unq: re-running the sync re-attaches the same commits.
			.onConflictDoNothing();
	}
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

export const timeEntriesService = {
	listRange: async (ctx: Ctx, range: { from: string; to: string }) => {
		await recurringBlockRulesService.materializeRange(
			ctx,
			range.from,
			range.to,
		);

		const tz = await ctxTimezone(ctx);

		try {
			const settings = await integrationSettingsService.get(ctx);
			if (settings.googleAutoSyncMeetings) {
				// Only the part of the requested range the sync window covers. Reading
				// a month is not a request to import a month of meetings — see
				// lib/meeting-window. Outside the window this is simply skipped, and
				// the entries already imported there are still read and shown.
				const syncable = clampToMeetingSyncWindow(
					range,
					dayKeyInTz(new Date(), tz),
				);
				if (syncable) {
					await syncMeetingsForRange(ctx, syncable, tz).catch((error) =>
						console.error("[time-entries] meeting sync failed", error),
					);
				}
			}
			if (settings.githubSyncCommitsAsWorkTime) {
				await syncCommitWorkTimeForRange(ctx, range, tz).catch((error) =>
					console.error("[time-entries] commit work-time sync failed", error),
				);
			}
		} catch (error) {
			console.error("[time-entries] integration sync skipped", error);
		}

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
		if (fills.length > 0) {
			const workingHours = await workingHoursService.list(ctx);
			const claimsByDay = new Map<string, typeof rows>();
			for (const r of rows) {
				const list = claimsByDay.get(r.date) ?? [];
				list.push(r);
				claimsByDay.set(r.date, list);
			}
			const emptied: string[] = [];
			for (const fill of fills) {
				const next = remainingSeconds(
					targetSecondsFor(workingHours, fill.date, tz),
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
				await db.delete(timeEntry).where(inArray(timeEntry.id, emptied));
				const dropped = new Set(emptied);
				visible = rows.filter((r) => !dropped.has(r.id));
			}
		}

		// Commit counts, so the week grid can badge entries that have work evidence
		// attached (a count query rather than a relation, to avoid a
		// domain.ts <-> github.ts import cycle).
		const commitCountById = new Map<string, number>();
		if (visible.length > 0) {
			const counts = await db
				.select({
					timeEntryId: timeEntryGithubCommit.timeEntryId,
					count: count(),
				})
				.from(timeEntryGithubCommit)
				.where(
					inArray(
						timeEntryGithubCommit.timeEntryId,
						visible.map((r) => r.id),
					),
				)
				.groupBy(timeEntryGithubCommit.timeEntryId);
			for (const c of counts) commitCountById.set(c.timeEntryId, c.count);
		}

		return visible.map((row) => ({
			...row,
			commitCount: commitCountById.get(row.id) ?? 0,
		}));
	},

	/** Background-job entrypoint: import a user's meetings for a fixed window,
	 *  without the rest of listRange's read work. */
	syncMeetingsForUser: async (
		ctx: Ctx,
		range: { from: string; to: string },
	) => {
		const tz = await ctxTimezone(ctx);
		await syncMeetingsForRange(ctx, range, tz);
	},

	create: async (ctx: Ctx, input: CreateTimeEntryInput) => {
		if (input.projectId) {
			await assertProjectInOrg(ctx, input.projectId);
			const access = await ctxAccess(ctx);
			access.assertCanTrackOn(input.projectId);
		}
		await assertTaskAvailable(ctx, input.taskId, input.projectId);

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
				// worked time; corrections live in the close sheet's Adjusted column.
				eq(timeEntry.userId, ctx.userId),
			),
		});
		if (!existing) throw new Error("Time entry not found");

		if (input.projectId) {
			await assertProjectInOrg(ctx, input.projectId);
			const access = await ctxAccess(ctx);
			access.assertCanTrackOn(input.projectId);
		}
		await assertTaskAvailable(ctx, input.taskId, input.projectId);

		const tz = await ctxTimezone(ctx);
		// The entry being edited is excluded from its own claim: converting a 2h
		// block into the day's fill block must not count that 2h as competing with
		// the fill it is becoming.
		const durationSeconds = input.fillsDay
			? await computeDayFillSeconds(
					ctx,
					input.date,
					tz,
					undefined,
					input.timeEntryId,
				)
			: (input.durationSeconds ?? 0);

		if (input.fillsDay && durationSeconds === 0) {
			throw new Error(
				"This day's working hours are already fully logged — nothing left to fill",
			);
		}

		const updated = await withCtxTx(ctx, async (txCtx) => {
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
		for (const timeEntryId of input.timeEntryIds) {
			try {
				await timeEntriesService.file(ctx, {
					timeEntryId,
					projectId: input.projectId,
				});
				filed++;
			} catch (error) {
				reasons.push(
					error instanceof Error ? error.message : "Could not file entry",
				);
			}
		}
		return { filed, failed: reasons.length, firstError: reasons[0] };
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
				await tx
					.update(timeEntry)
					.set({
						durationSeconds: input.durationSeconds,
						...(input.description !== undefined
							? { description: input.description.trim() }
							: {}),
						updatedAt: new Date(),
					})
					.where(eq(timeEntry.id, primary.id));
				for (const row of duplicates) {
					await timeEntriesService.remove(txCtx, row.id);
				}
				await recomputeDayFill(txCtx, input.date, tz);
				return { entryId: primary.id };
			}

			// Creating fresh: the mandatory-description rule still applies, so reuse
			// the row's note from another day in the same grid row rather than
			// inventing one or writing an empty string.
			const description = input.description?.trim() ?? "";
			const created = await timeEntriesService.create(txCtx, {
				date: input.date,
				projectId: input.projectId,
				taskId: input.taskId,
				description: description || undefined,
				durationSeconds: input.durationSeconds,
				overtime: false,
				fillsDay: false,
			});
			return { entryId: created.id };
		});
	},

	/** Copy a day's entries onto another day. The backfill affordance that stands
	 *  in for a running timer: most people work a similar shape most days.
	 *
	 *  Three rules, each of which used to be missing:
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
	 *  - Copying twice is a no-op, not a doubling. An entry whose (project, task,
	 *    duration, note) already sits on the target day is skipped, so leaning on
	 *    the button is harmless.
	 *  - The result must fit in a day. */
	copyDay: async (ctx: Ctx, input: CopyTimeEntriesInput) => {
		if (input.fromDate === input.toDate) return { copied: 0, skipped: 0 };

		return withCtxTx(ctx, async (txCtx) => {
			const tx = ctxDb(txCtx);
			const dayRows = (date: string) =>
				tx.query.timeEntry.findMany({
					where: and(
						eq(timeEntry.organizationId, ctx.organizationId),
						eq(timeEntry.userId, ctx.userId),
						eq(timeEntry.date, date),
						// A fill block is derived from what is left of the day, so copying
						// one forward would just be recomputed away.
						eq(timeEntry.fillsDay, false),
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

			const alreadyThere = new Set(target.map(sameWork));
			const copyable: typeof source = [];
			for (const entry of source) {
				const key = sameWork(entry);
				if (alreadyThere.has(key)) continue;
				// Guards against a source day that itself holds two identical rows.
				alreadyThere.add(key);
				copyable.push(entry);
			}
			const skipped = source.length - copyable.length;
			if (copyable.length === 0) return { copied: 0, skipped };

			const addedSeconds = copyable.reduce(
				(sum, e) => sum + e.durationSeconds,
				0,
			);
			const existingSeconds = spokenForSeconds(target);
			if (existingSeconds + addedSeconds > MAX_DAY_SECONDS) {
				throw new Error(
					`Copying this would put more than 24 hours on ${input.toDate}`,
				);
			}

			await tx.insert(timeEntry).values(
				copyable.map((e) => ({
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

			const tz = await ctxTimezone(txCtx);
			await recomputeDayFill(txCtx, input.toDate, tz);
			return { copied: copyable.length, skipped };
		});
	},

	/** `copyDay` seven times, pairing the weeks up by offset so last Tuesday
	 *  lands on this Tuesday.
	 *
	 *  A day that would breach the 24-hour ceiling is reported rather than
	 *  aborting the week: one over-full Wednesday should not cost you the other
	 *  six days. `copyDay` checks the ceiling before it writes anything, so
	 *  catching here cannot leave a day half-copied. */
	copyWeek: async (ctx: Ctx, input: CopyWeekEntriesInput) => {
		if (input.fromWeekStart === input.toWeekStart) {
			return { copied: 0, skipped: 0, blockedDays: [] as string[] };
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
				} catch {
					blockedDays.push(toDate);
				}
			}

			return { copied, skipped, blockedDays };
		});
	},

	// ── Absence corrections (PM / Admin) ──────────────────────────────────────
	// PMs can override or correct Vacation and Sick Leave entries for people on
	// their projects (PRD 3.5). This is the ONE case where someone edits another
	// person's entries — and it is deliberately limited to absence: worked-time
	// corrections belong in the close sheet's Adjusted column, which is what keeps
	// "what people said they worked" and "what we billed" separate.

	/** One person's Vacation/Sick entries for a month, for the PM correcting them
	 *  from the close sheet. Same permission as the writes below — a PM may read
	 *  the absence of people on their own projects, nobody else's. */
	listAbsenceForUser: async (ctx: Ctx, input: ListAbsenceForUserInput) => {
		const access = await ctxAccess(ctx);
		const shared = await projectIdsForUser(ctx, input.userId);
		if (!access.canOverrideAbsenceFor(shared)) {
			throw new Error("You cannot see this person's absence");
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
			throw new Error("Only Vacation and Sick Leave entries can be corrected");
		}

		const access = await ctxAccess(ctx);
		const shared = await projectIdsForUser(ctx, existing.userId);
		if (!access.canOverrideAbsenceFor(shared)) {
			throw new Error("You cannot correct this person's absence");
		}

		const [updated] = await db
			.update(timeEntry)
			.set({
				durationSeconds: input.durationSeconds,
				...(input.description !== undefined
					? { description: input.description }
					: {}),
				updatedAt: new Date(),
			})
			.where(eq(timeEntry.id, input.timeEntryId))
			.returning();
		return updated;
	},

	createAbsenceForUser: async (ctx: Ctx, input: CreateAbsenceForUserInput) => {
		const absenceIds = await tasksService.absenceTaskIds();
		if (!absenceIds.has(input.taskId)) {
			throw new Error("Only Vacation and Sick Leave can be logged this way");
		}

		const access = await ctxAccess(ctx);
		const shared = await projectIdsForUser(ctx, input.userId);
		if (!access.canOverrideAbsenceFor(shared)) {
			throw new Error("You cannot log absence for this person");
		}

		const [created] = await db
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
		return created;
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
			throw new Error(
				"Only Vacation and Sick Leave entries can be removed here",
			);
		}

		const access = await ctxAccess(ctx);
		const shared = await projectIdsForUser(ctx, existing.userId);
		if (!access.canOverrideAbsenceFor(shared)) {
			throw new Error("You cannot correct this person's absence");
		}

		await db.delete(timeEntry).where(eq(timeEntry.id, timeEntryId));
		return existing;
	},
};
