import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { db } from "../db";
import { organization } from "../db/schema/auth";
import { task, timeEntry } from "../db/schema/domain";
import { runningTimer, timerSettings } from "../db/schema/timer";
import { loggableError } from "../lib/loggable-error";
import { formatDurationShort, safeTimezone, timeKeyInTz } from "../lib/time";
import { publishTimerChange } from "../services/native-push";
import { notify } from "../services/notify";
import {
	DEFAULT_TIMER_MAX_SECONDS,
	taskIdOf,
} from "../services/timers.service";

export type TimerSweepSummary = {
	running: number;
	dropped: number;
	failed: number;
};

// The answer to the objection on issue #59: people forget to stop a stopwatch.
//
// A timer that has run longer than the cap its owner set (Settings ->
// Preferences, 12 hours by default) is no longer a measurement of anything, so
// this drops it. It does NOT log the time: a figure nobody chose is the very
// thing the stopwatch was designed not to produce.
//
// The row is marked rather than deleted. `timersService.get` shows the notice
// on the next read from the web app or the CLI, and dismissing it clears the
// row. That is the only channel that reaches everybody — a push needs a granted
// browser permission and Slack needs an installed app, so the notification sent
// here is the courtesy and the notice is the promise.
//
// Idempotent: a dropped row is not running any more, so a second pass sees
// nothing to do.
export const runTimerSweepOnce = async (
	opts: { now?: Date } = {},
): Promise<TimerSweepSummary> => {
	const now = opts.now ?? new Date();

	// One query for every running timer and the cap of the person who started
	// it, rather than one read for each person.
	const rows = await db
		.select({
			id: runningTimer.id,
			organizationId: runningTimer.organizationId,
			organizationSlug: organization.slug,
			timezone: organization.timezone,
			userId: runningTimer.userId,
			taskName: task.name,
			startedAt: runningTimer.startedAt,
			runningSince: runningTimer.runningSince,
			accumulatedSeconds: runningTimer.accumulatedSeconds,
			maxSeconds: timerSettings.maxSeconds,
		})
		.from(runningTimer)
		.innerJoin(organization, eq(organization.id, runningTimer.organizationId))
		// The task the notice names is the one the card shows: the continued
		// entry's own while it exists (issue #121), through the shared rule.
		.leftJoin(timeEntry, eq(timeEntry.id, runningTimer.timeEntryId))
		.innerJoin(task, eq(task.id, taskIdOf))
		.leftJoin(
			timerSettings,
			and(
				eq(timerSettings.organizationId, runningTimer.organizationId),
				eq(timerSettings.userId, runningTimer.userId),
			),
		)
		// A paused timer is left alone, however long it has been held. The cap is
		// a limit on measured time, and a paused timer measures nothing — its
		// figure cannot grow into the cap, and holding one is a thing somebody
		// chose rather than a thing they forgot.
		.where(
			and(isNull(runningTimer.droppedAt), isNotNull(runningTimer.runningSince)),
		);

	const summary: TimerSweepSummary = {
		running: rows.length,
		dropped: 0,
		failed: 0,
	};

	for (const row of rows) {
		// The segments that finished plus the one still running — the same figure
		// `timersService` shows, so what the person reads is what is measured
		// against the cap.
		const elapsed =
			row.accumulatedSeconds +
			Math.round(
				(now.getTime() - (row.runningSince ?? row.startedAt).getTime()) / 1000,
			);
		const cap = row.maxSeconds ?? DEFAULT_TIMER_MAX_SECONDS;
		if (elapsed <= cap) continue;

		try {
			const changed = await db
				.update(runningTimer)
				.set({ droppedAt: now, updatedAt: now })
				.where(
					and(
						eq(runningTimer.id, row.id),
						isNull(runningTimer.droppedAt),
						isNotNull(runningTimer.runningSince),
					),
				)
				.returning({ id: runningTimer.id });
			// The row changed since the read: a confirm, a pause or another sweep.
			// Count nothing, and send nothing: an `end` would close a newer Live
			// Activity.
			if (changed.length === 0) continue;
			summary.dropped += 1;
			// The phone's Live Activity ends now. It returns at once.
			publishTimerChange(row.userId, { type: "end" });

			const startedAtLabel = timeKeyInTz(
				row.startedAt,
				safeTimezone(row.timezone),
			);
			await notify(
				{ organizationId: row.organizationId, userId: row.userId },
				{
					kind: "timer-dropped",
					title: "Your timer was dropped",
					body: `It started at ${startedAtLabel} on ${row.taskName} and ran past your ${formatDurationShort(cap)} limit, so nothing was logged. Log the time by hand.`,
					url: `/${row.organizationSlug}/time`,
					tag: "timer-dropped",
				},
			);
		} catch (error) {
			summary.failed += 1;
			console.error(
				"[timer-sweep] failed to drop a timer",
				loggableError(error),
			);
		}
	}

	return summary;
};
