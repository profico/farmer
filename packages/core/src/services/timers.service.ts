import { and, eq } from "drizzle-orm";

import { organization } from "../db/schema/auth";
import { project, task } from "../db/schema/domain";
import { runningTimer, timerSettings } from "../db/schema/timer";
import { descriptionRequiredFor } from "../lib/task-rules";
import { snapToQuarterHour } from "../lib/time";
import type {
	ConfirmTimerInput,
	StartTimerInput,
	TimerSettingsInput,
	UpdateTimerInput,
} from "../schema/timer";
import { ctxAccess, ctxDb, withCtxTx } from "./context";
import { assertProjectInOrg, assertTaskAvailable } from "./guards";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

/**
 * The stopwatch (issues #59 and #43).
 *
 * It measures. It does not record: `confirm` is the only function here that
 * writes a time entry, and it writes one through `timeEntriesService.create`,
 * so every rule an entry has — the day's 24 hours, the mandatory note, the task
 * taxonomy — applies to a measured hour exactly as it does to a typed one.
 * That is the whole answer to "a stopwatch produces figures like 2:12": the
 * figure is snapped before anybody sees it, and what is saved is what they
 * confirmed.
 *
 * One timer per PERSON, not per workspace — see `db/schema/timer.ts`. Every
 * function still takes a Ctx, and a function that writes still names the
 * organization, but `get` deliberately does not filter by it: a timer running
 * in another workspace must be visible from this one, or the person is told
 * that nothing is running while something is.
 */

/** The default cap on a timer nobody stopped. A missing `timer_settings` row
 *  means this, as a missing `notification_settings` row means its defaults. */
export const DEFAULT_TIMER_MAX_SECONDS = 12 * 3600;

export type TimerView = {
	id: string;
	organizationId: string;
	/** The workspace the entry will land in — its slug and name, so a surface in
	 *  another workspace can say where the timer is running. */
	organizationSlug: string;
	organizationName: string;
	/** True when the timer belongs to the workspace that asked. */
	here: boolean;
	projectId: string | null;
	projectName: string | null;
	taskId: string;
	taskName: string;
	/** Whether the entry this timer becomes will need a note — the task rule,
	 *  answered here rather than restated by each surface. The CLI cannot read
	 *  `lib/task-rules` at all (its import boundary is linted), and asking for a
	 *  note it does not need is as wrong as refusing one it does. */
	taskNeedsDescription: boolean;
	description: string;
	/** When the clock first began — never moved by a pause. */
	startedAt: Date;
	/** True while the clock is held. A paused timer measures nothing, keeps its
	 *  figure and may be held for as long as somebody wants. */
	paused: boolean;
	/** Null while it runs; set once the sweep dropped it for passing the cap. */
	droppedAt: Date | null;
	/** Seconds measured so far, or the whole run of a dropped timer. Pauses are
	 *  not in it: what is counted is the running segments. */
	elapsedSeconds: number;
	/** What confirming it would log: `snapToQuarterHour(elapsedSeconds)`, which
	 *  rounds to the NEAREST quarter hour and never below one. The figure is
	 *  shown before it is saved, and may be corrected there. */
	snappedSeconds: number;
	/** The server's clock, so a browser with a wrong one can draw the elapsed
	 *  figure against the same instant the server will measure against. */
	serverNow: Date;
};

/** What the clock has measured: the segments that finished, plus the one that
 *  is running. A paused timer has no running segment, so its figure stands
 *  still — that is the whole of what a pause does. */
const elapsedOf = (
	row: {
		runningSince: Date | null;
		accumulatedSeconds: number;
		droppedAt: Date | null;
	},
	now: Date,
) => {
	const current = row.runningSince
		? ((row.droppedAt ?? now).getTime() - row.runningSince.getTime()) / 1000
		: 0;

	return Math.max(0, row.accumulatedSeconds + Math.round(current));
};

const rowOf = async (ctx: Ctx, userId: string) =>
	ctxDb(ctx)
		.select({
			id: runningTimer.id,
			organizationId: runningTimer.organizationId,
			organizationSlug: organization.slug,
			organizationName: organization.name,
			projectId: runningTimer.projectId,
			projectName: project.name,
			taskId: runningTimer.taskId,
			taskName: task.name,
			taskIsAbsence: task.isAbsence,
			taskSystemKey: task.systemKey,
			description: runningTimer.description,
			startedAt: runningTimer.startedAt,
			runningSince: runningTimer.runningSince,
			accumulatedSeconds: runningTimer.accumulatedSeconds,
			droppedAt: runningTimer.droppedAt,
		})
		.from(runningTimer)
		.innerJoin(organization, eq(organization.id, runningTimer.organizationId))
		.innerJoin(task, eq(task.id, runningTimer.taskId))
		.leftJoin(project, eq(project.id, runningTimer.projectId))
		.where(eq(runningTimer.userId, userId))
		.limit(1);

const viewOf = (
	ctx: Ctx,
	row: Awaited<ReturnType<typeof rowOf>>[number],
	now: Date,
): TimerView => {
	const elapsedSeconds = elapsedOf(row, now);

	return {
		...row,
		here: row.organizationId === ctx.organizationId,
		taskNeedsDescription: descriptionRequiredFor({
			isAbsence: row.taskIsAbsence,
			systemKey: row.taskSystemKey,
		}),
		paused: row.runningSince === null && row.droppedAt === null,
		elapsedSeconds,
		snappedSeconds: snapToQuarterHour(elapsedSeconds),
		serverNow: now,
	};
};

/** The person's own timer, or null. Reads by person, never by workspace. */
const read = async (ctx: Ctx, now: Date): Promise<TimerView | null> => {
	const [row] = await rowOf(ctx, ctx.userId);

	return row ? viewOf(ctx, row, now) : null;
};

/** The three sentences every control on a timer has to be able to say before
 *  it touches the row: there is one, it is not a dropped notice, and it belongs
 *  to the workspace that asked. `verb` names the control in the message. */
const assertDrivable = async (
	ctx: Ctx,
	now: Date,
	verb: string,
): Promise<TimerView> => {
	const running = await read(ctx, now);
	if (!running) throw new Error("No timer is running");
	if (running.droppedAt) {
		throw new Error("This timer was dropped and can only be dismissed");
	}
	if (!running.here) {
		throw new Error(
			`This timer belongs to ${running.organizationName}. ${verb} it there.`,
		);
	}

	return running;
};

export const timersService = {
	get: async (ctx: Ctx, opts: { now?: Date } = {}): Promise<TimerView | null> =>
		read(ctx, opts.now ?? new Date()),

	/**
	 * Start measuring.
	 *
	 * The running row is read first so a second start answers a sentence naming
	 * what is already running, rather than the driver error that
	 * `running_timer_user_unq` would otherwise raise — which every surface can
	 * only report as a server failure. `timeEntriesService.create` asks the same
	 * question of the fill-block index for the same reason.
	 */
	start: async (
		ctx: Ctx,
		input: StartTimerInput,
		opts: { now?: Date } = {},
	): Promise<TimerView> => {
		const now = opts.now ?? new Date();
		const running = await read(ctx, now);
		if (running) {
			throw new Error(
				running.droppedAt
					? "A timer is waiting to be dismissed. Dismiss it, then start a new one."
					: running.here
						? `A timer is already running on ${running.taskName}. Stop it first.`
						: `A timer is already running in ${running.organizationName}. Stop it first.`,
			);
		}

		if (input.projectId) {
			await assertProjectInOrg(ctx, input.projectId);
			(await ctxAccess(ctx)).assertCanTrackOn(input.projectId);
		}
		const taskRow = await assertTaskAvailable(
			ctx,
			input.taskId,
			input.projectId,
		);
		if (taskRow.isAbsence) {
			throw new Error("Time off is booked as a span, not measured by a timer");
		}

		await ctxDb(ctx)
			.insert(runningTimer)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				projectId: input.projectId ?? null,
				taskId: input.taskId,
				description: input.description?.trim() ?? "",
				startedAt: now,
				runningSince: now,
			});

		const started = await read(ctx, now);
		if (!started) throw new Error("Failed to start the timer");

		return started;
	},

	/** Change what a running timer says it is measuring. */
	update: async (
		ctx: Ctx,
		input: UpdateTimerInput,
		opts: { now?: Date } = {},
	): Promise<TimerView> => {
		const now = opts.now ?? new Date();
		const running = await read(ctx, now);
		if (!running) throw new Error("No timer is running");
		if (running.droppedAt) {
			throw new Error("This timer was dropped and can only be dismissed");
		}
		if (!running.here) {
			throw new Error(
				`This timer belongs to ${running.organizationName}. Change it there.`,
			);
		}

		const projectId =
			input.projectId === undefined ? running.projectId : input.projectId;
		const taskId = input.taskId ?? running.taskId;

		if (projectId) {
			await assertProjectInOrg(ctx, projectId);
			(await ctxAccess(ctx)).assertCanTrackOn(projectId);
		}
		const taskRow = await assertTaskAvailable(
			ctx,
			taskId,
			projectId ?? undefined,
		);
		if (taskRow.isAbsence) {
			throw new Error("Time off is booked as a span, not measured by a timer");
		}

		await ctxDb(ctx)
			.update(runningTimer)
			.set({
				projectId,
				taskId,
				description:
					input.description === undefined
						? running.description
						: input.description.trim(),
				updatedAt: now,
			})
			.where(eq(runningTimer.id, running.id));

		const updated = await read(ctx, now);
		if (!updated) throw new Error("Failed to update the timer");

		return updated;
	},

	/**
	 * Hold the clock, for as long as somebody wants.
	 *
	 * The running segment is banked into `accumulatedSeconds` and the row stops
	 * measuring, so nothing grows while a person is at lunch or in a meeting
	 * about something else. `jobs/timer-sweep.ts` skips a paused timer for the
	 * same reason: the cap is a limit on measured time, and a paused timer is
	 * not measuring.
	 *
	 * Pausing an already paused timer answers the row as it stands rather than
	 * refusing. Two surfaces drive one clock, and a phone that pressed pause a
	 * second after a laptop did should not be shown an error about it.
	 */
	pause: async (ctx: Ctx, opts: { now?: Date } = {}): Promise<TimerView> => {
		const now = opts.now ?? new Date();
		const running = await assertDrivable(ctx, now, "Pause");
		if (running.paused) return running;

		await ctxDb(ctx)
			.update(runningTimer)
			.set({
				runningSince: null,
				accumulatedSeconds: running.elapsedSeconds,
				updatedAt: now,
			})
			.where(eq(runningTimer.id, running.id));

		const paused = await read(ctx, now);
		if (!paused) throw new Error("Failed to pause the timer");

		return paused;
	},

	/** Start a new running segment. Resuming a timer that is already running
	 *  answers it unchanged, for the reason `pause` gives. */
	resume: async (ctx: Ctx, opts: { now?: Date } = {}): Promise<TimerView> => {
		const now = opts.now ?? new Date();
		const running = await assertDrivable(ctx, now, "Resume");
		if (!running.paused) return running;

		await ctxDb(ctx)
			.update(runningTimer)
			.set({ runningSince: now, updatedAt: now })
			.where(eq(runningTimer.id, running.id));

		const resumed = await read(ctx, now);
		if (!resumed) throw new Error("Failed to resume the timer");

		return resumed;
	},

	/**
	 * Log the measured time and clear the timer, in one transaction.
	 *
	 * Everything that can refuse the entry refuses the whole thing, and the
	 * timer survives: an archived task, a note the task requires and nobody
	 * wrote, a day already holding 24 hours. Losing a measurement to a message
	 * the person can act on would be the one unforgivable bug in a stopwatch.
	 *
	 * The project is re-checked for being live, because a timer outlives the
	 * project state that was true when it started — the same reason a recurring
	 * block rule re-checks on every materializing pass.
	 */
	confirm: async (ctx: Ctx, input: ConfirmTimerInput) => {
		const running = await read(ctx, new Date());
		if (!running) throw new Error("No timer is running");
		if (running.droppedAt) {
			throw new Error("This timer was dropped and can only be dismissed");
		}
		if (!running.here) {
			throw new Error(
				`This timer belongs to ${running.organizationName}. Stop it there.`,
			);
		}

		if (input.projectId) {
			const live = await ctxDb(ctx).query.project.findFirst({
				where: and(
					eq(project.id, input.projectId),
					eq(project.organizationId, ctx.organizationId),
					eq(project.status, "active"),
				),
				columns: { id: true },
			});
			if (!live) {
				throw new Error(
					"That project is archived. Pick another one for this time.",
				);
			}
		}

		return withCtxTx(ctx, async (txCtx) => {
			const entry = await timeEntriesService.create(txCtx, {
				date: input.date,
				projectId: input.projectId,
				taskId: input.taskId,
				description: input.description,
				durationSeconds: input.durationSeconds,
				overtime: input.overtime,
				fillsDay: false,
			});

			await ctxDb(txCtx)
				.delete(runningTimer)
				.where(eq(runningTimer.id, running.id));

			return entry;
		});
	},

	/** Throw the timer away — or clear the notice a dropped one left. */
	discard: async (ctx: Ctx): Promise<void> => {
		await ctxDb(ctx)
			.delete(runningTimer)
			.where(eq(runningTimer.userId, ctx.userId));
	},

	settings: async (ctx: Ctx): Promise<{ maxSeconds: number }> => {
		const row = await ctxDb(ctx).query.timerSettings.findFirst({
			where: and(
				eq(timerSettings.organizationId, ctx.organizationId),
				eq(timerSettings.userId, ctx.userId),
			),
			columns: { maxSeconds: true },
		});

		return { maxSeconds: row?.maxSeconds ?? DEFAULT_TIMER_MAX_SECONDS };
	},

	setSettings: async (
		ctx: Ctx,
		input: TimerSettingsInput,
	): Promise<{ maxSeconds: number }> => {
		await ctxDb(ctx)
			.insert(timerSettings)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				maxSeconds: input.maxSeconds,
			})
			.onConflictDoUpdate({
				target: [timerSettings.organizationId, timerSettings.userId],
				set: { maxSeconds: input.maxSeconds, updatedAt: new Date() },
			});

		return { maxSeconds: input.maxSeconds };
	},
};
