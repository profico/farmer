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
import { orgTimezone } from "../lib/org-time";
import {
	dayKeyInTz,
	monthBounds,
	snapToQuarterHour,
	weekdayInTz,
} from "../lib/time";
import type {
	CopyTimeEntriesInput,
	CreateAbsenceForUserInput,
	CreateTimeEntryInput,
	ListAbsenceForUserInput,
	OverrideAbsenceEntryInput,
	SetTimeEntryOvertimeInput,
	SetWeekCellInput,
	UpdateTimeEntryDescriptionInput,
	UpdateTimeEntryInput,
} from "../schema/time-entries";
import { accessService } from "./access.service";
import { assertProjectInOrg, assertTaskAvailable } from "./guards";
import { githubService } from "./github.service";
import { googleCalendarService } from "./google-calendar.service";
import { integrationSettingsService } from "./integration-settings.service";
import { recurringBlockRulesService } from "./recurring-block-rules.service";
import { tasksService } from "./tasks.service";
import type { Ctx } from "./types";
import {
	dayDurationSeconds,
	type WorkingHoursDay,
	workingHoursService,
} from "./working-hours.service";

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

type DbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// How long a fill block on this day should be: the day's working-hours target
// minus every other (non-fill) entry that day, floored at 0.
const computeDayFillSeconds = async (
	ctx: Ctx,
	dateKey: string,
	tz: string,
	workingHours?: WorkingHoursDay[],
	client: DbClient = db,
): Promise<number> => {
	const [dayEntries, hours] = await Promise.all([
		client.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				eq(timeEntry.date, dateKey),
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

// Re-derive the duration of the day's fill block (if any) after a sibling entry
// changed. No-op when the day has no fill block.
const recomputeDayFill = async (
	ctx: Ctx,
	dateKey: string,
	tz: string,
	client: DbClient = db,
) => {
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
	const next = await computeDayFillSeconds(ctx, dateKey, tz, undefined, client);
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
	const events = await googleCalendarService.listEventsForRange(ctx, range);
	// null => couldn't read the calendar (disconnected / revoked token). Bail
	// without deleting, or we'd wipe synced entries we merely failed to fetch.
	if (events === null) return;

	const meetingTask = await db.query.task.findFirst({
		where: and(
			eq(task.organizationId, ctx.organizationId),
			eq(task.name, "Meeting"),
			eq(task.isAbsence, false),
		),
		columns: { id: true },
	});
	if (!meetingTask) return;

	const tombstones = await db.query.syncedMeetingTombstone.findMany({
		where: and(
			eq(syncedMeetingTombstone.organizationId, ctx.organizationId),
			eq(syncedMeetingTombstone.userId, ctx.userId),
		),
		columns: { calendarEventId: true },
	});
	const tombstoned = new Set(tombstones.map((t) => t.calendarEventId));

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
// only logs meetings and breaks, the fill absorbs the remainder.
const syncCommitWorkTimeForRange = async (
	ctx: Ctx,
	range: { from: string; to: string },
	tz: string,
) => {
	const dayKeys = await githubService.listUserCommitDays(ctx, range);
	if (dayKeys.length === 0) return;

	// The fill block needs a task like any other entry. "Development" is the
	// conventional name; without it there's nothing sensible to attribute the
	// time to, so the engine stays out of the way rather than guessing.
	const workTask = await db.query.task.findFirst({
		where: and(
			eq(task.organizationId, ctx.organizationId),
			eq(task.name, "Development"),
			eq(task.isAbsence, false),
		),
		columns: { id: true },
	});
	if (!workTask) return;

	const workingHours = await workingHoursService.list(ctx);
	for (const dayKey of dayKeys) {
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
				taskId: workTask.id,
				projectId: null,
				description: "",
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
			});
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
		await recurringBlockRulesService.materializeRange(ctx, range.from, range.to);

		const tz = await orgTimezone(ctx.organizationId);

		try {
			const settings = await integrationSettingsService.get(ctx);
			if (settings.googleAutoSyncMeetings) {
				await syncMeetingsForRange(ctx, range, tz).catch((error) =>
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
		const fills = rows.filter((r) => r.fillsDay);
		if (fills.length > 0) {
			const workingHours = await workingHoursService.list(ctx);
			const sumByDay = new Map<string, number>();
			for (const r of rows) {
				if (r.fillsDay) continue;
				sumByDay.set(r.date, (sumByDay.get(r.date) ?? 0) + r.durationSeconds);
			}
			for (const fill of fills) {
				const target = dayFillTargetSeconds(workingHours, fill.date, tz);
				const next = Math.max(0, target - (sumByDay.get(fill.date) ?? 0));
				if (next === fill.durationSeconds) continue;
				await db
					.update(timeEntry)
					.set({ durationSeconds: next, updatedAt: new Date() })
					.where(eq(timeEntry.id, fill.id));
				fill.durationSeconds = next;
			}
		}

		// Commit counts, so the week grid can badge entries that have work evidence
		// attached (a count query rather than a relation, to avoid a
		// domain.ts <-> github.ts import cycle).
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

	/** Background-job entrypoint: import a user's meetings for a fixed window,
	 *  without the rest of listRange's read work. */
	syncMeetingsForUser: async (
		ctx: Ctx,
		range: { from: string; to: string },
	) => {
		const tz = await orgTimezone(ctx.organizationId);
		await syncMeetingsForRange(ctx, range, tz);
	},

	create: async (ctx: Ctx, input: CreateTimeEntryInput) => {
		if (input.projectId) {
			await assertProjectInOrg(ctx, input.projectId);
			const access = await accessService.resolve(ctx);
			access.assertCanTrackOn(input.projectId);
		}
		await assertTaskAvailable(ctx, input.taskId, input.projectId);

		const tz = await orgTimezone(ctx.organizationId);
		const durationSeconds = input.fillsDay
			? await computeDayFillSeconds(ctx, input.date, tz)
			: (input.durationSeconds ?? 0);

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

		return db.transaction(async (tx) => {
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

			// A new normal entry shrinks whatever fill block shares its day.
			if (!input.fillsDay) await recomputeDayFill(ctx, input.date, tz, tx);
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
			const access = await accessService.resolve(ctx);
			access.assertCanTrackOn(input.projectId);
		}
		await assertTaskAvailable(ctx, input.taskId, input.projectId);

		const tz = await orgTimezone(ctx.organizationId);
		const durationSeconds = input.fillsDay
			? await computeDayFillSeconds(ctx, input.date, tz)
			: (input.durationSeconds ?? 0);

		const updated = await db.transaction(async (tx) => {
			let row: typeof timeEntry.$inferSelect | undefined;
			try {
				[row] = await tx
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

			await recomputeDayFill(ctx, input.date, tz, tx);
			if (existing.date !== input.date) {
				await recomputeDayFill(ctx, existing.date, tz, tx);
			}
			return row;
		});
		return updated;
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
			return existing;
		});

		if (deleted && !deleted.fillsDay) {
			const tz = await orgTimezone(ctx.organizationId);
			await recomputeDayFill(ctx, deleted.date, tz);
		}

		// Returned so the caller can offer an "undo" that re-creates the row.
		return deleted ?? null;
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
			const access = await accessService.resolve(ctx);
			access.assertCanTrackOn(input.projectId);
		}
		await assertTaskAvailable(ctx, input.taskId, input.projectId);

		const matches = await db.query.timeEntry.findMany({
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

		const tz = await orgTimezone(ctx.organizationId);
		const [primary, ...duplicates] = matches;

		if (input.durationSeconds === 0) {
			for (const row of matches) await timeEntriesService.remove(ctx, row.id);
			return { cleared: matches.length };
		}

		if (primary) {
			await db
				.update(timeEntry)
				.set({
					durationSeconds: input.durationSeconds,
					...(input.description !== undefined
						? { description: input.description.trim() }
						: {}),
					updatedAt: new Date(),
				})
				.where(eq(timeEntry.id, primary.id));
			for (const row of duplicates) await timeEntriesService.remove(ctx, row.id);
			await recomputeDayFill(ctx, input.date, tz);
			return { entryId: primary.id };
		}

		// Creating fresh: the mandatory-description rule still applies, so reuse
		// the row's note from another day in the same grid row rather than
		// inventing one or writing an empty string.
		const description = input.description?.trim() ?? "";
		const created = await timeEntriesService.create(ctx, {
			date: input.date,
			projectId: input.projectId,
			taskId: input.taskId,
			description: description || undefined,
			durationSeconds: input.durationSeconds,
			overtime: false,
			fillsDay: false,
		});
		return { entryId: created.id };
	},

	/** Copy a day's entries onto another day. The backfill affordance that stands
	 *  in for a running timer: most people work a similar shape most days. */
	copyDay: async (ctx: Ctx, input: CopyTimeEntriesInput) => {
		if (input.fromDate === input.toDate) return { copied: 0 };

		const source = await db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				eq(timeEntry.date, input.fromDate),
				// Fill blocks are derived, and calendar meetings belong to the day they
				// actually happened — neither is meaningful to duplicate.
				eq(timeEntry.fillsDay, false),
			),
		});
		const copyable = source.filter((e) => e.calendarEventId == null);
		if (copyable.length === 0) return { copied: 0 };

		await db.insert(timeEntry).values(
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

		const tz = await orgTimezone(ctx.organizationId);
		await recomputeDayFill(ctx, input.toDate, tz);
		return { copied: copyable.length };
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
		const access = await accessService.resolve(ctx);
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

		const access = await accessService.resolve(ctx);
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

		const access = await accessService.resolve(ctx);
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
			throw new Error("Only Vacation and Sick Leave entries can be removed here");
		}

		const access = await accessService.resolve(ctx);
		const shared = await projectIdsForUser(ctx, existing.userId);
		if (!access.canOverrideAbsenceFor(shared)) {
			throw new Error("You cannot correct this person's absence");
		}

		await db.delete(timeEntry).where(eq(timeEntry.id, timeEntryId));
		return existing;
	},
};
