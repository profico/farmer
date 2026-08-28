import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization } from "../db/schema/auth";
import { timeEntry } from "../db/schema/domain";
import { withTimeout } from "../lib/http";
import {
	dayKeyInTz,
	formatDuration,
	timeKeyInTz,
	weekdayInTz,
} from "../lib/time";
import { dayDurationSeconds, dayForWeekday } from "../lib/working-day";
import { holidaysService } from "../services/holidays.service";
import { notificationsService } from "../services/notifications.service";
import { notify, wasDelivered } from "../services/notify";
import type { Ctx } from "../services/types";
import { workingHoursService } from "../services/working-hours.service";

export type LogReminderSummary = {
	eligible: number;
	sent: number;
	skipped: number;
	failed: number;
};

// End-of-day "you forgot to log" nudge. Runs on a timer (see the scheduler in
// apps/web/server.ts) and, for every member, fires a single push once their
// scheduled workday has ended IF they're under their expected hours for the day.
//
// Idempotent by construction: notificationSettings.lastLogReminderDay records
// the org-day-key we last reminded each user, so overlapping ticks and process
// restarts never double-send. A user is skipped (never reminded) when:
//   - they turned log reminders off,
//   - today isn't a scheduled working day for them (or has no end time),
//   - their workday hasn't ended yet in the org timezone,
//   - today is an org holiday,
//   - they've already logged at least their expected hours.
//
// Best-effort per user: one failure is logged and skipped, never aborts the run.

/** How many people are checked at once, and how long one person's check may
 *  take. The same shape as the automation sweep (jobs/automation-sync.ts) and
 *  for the same reason: this used to walk every member of every org serially,
 *  ~4 queries each, with nothing bounding either the pass or any single step.
 *  At a few hundred members that overran the tick, and one wedged query ended
 *  the sweep rather than degrading it. */
const SWEEP_CONCURRENCY = Number(process.env.LOG_REMINDERS_CONCURRENCY ?? 4);
const PER_USER_TIMEOUT_MS = Number(
	process.env.LOG_REMINDERS_USER_TIMEOUT_MS ?? 30_000,
);

export const runLogRemindersOnce = async (): Promise<LogReminderSummary> => {
	const now = new Date();

	const rows = await db
		.select({
			userId: member.userId,
			organizationId: member.organizationId,
			slug: organization.slug,
			timezone: organization.timezone,
		})
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId));

	let sent = 0;
	let skipped = 0;
	let failed = 0;

	const checkOne = async (row: (typeof rows)[number]) => {
		const ctx: Ctx = {
			organizationId: row.organizationId,
			userId: row.userId,
		};
		try {
			const tz = row.timezone ?? "UTC";
			const todayKey = dayKeyInTz(now, tz);

			// The "log reminders off" preference used to be checked right here, so
			// an opted-out person skipped the rest of the loop cheaply. `notify`
			// owns it now — for every channel, not just this one — which means the
			// checks below run for them too and the skip happens at the send. That
			// is a few extra reads per opted-out member on a background job, in
			// exchange for the preference being enforced in one place.

			// Already reminded for this day?
			const lastReminded = await notificationsService.lastLogReminderDay(
				row.organizationId,
				row.userId,
			);
			if (lastReminded === todayKey) {
				skipped++;
				return;
			}

			// A scheduled working day with a defined end time, and the day is over.
			const workingHours = await workingHoursService.list(ctx);
			const day = dayForWeekday(workingHours, weekdayInTz(todayKey, tz));
			const expectedSeconds = day ? dayDurationSeconds(day) : 0;
			if (expectedSeconds <= 0 || !day?.endTime) {
				skipped++;
				return;
			}
			// Only nag once the scheduled workday has ended (both "HH:mm", org tz).
			if (timeKeyInTz(now, tz) < day.endTime) {
				skipped++;
				return;
			}

			// Not on an org holiday.
			const holidays = await holidaysService.holidaySetForRange(
				ctx,
				todayKey,
				todayKey,
			);
			if (holidays.has(todayKey)) {
				skipped++;
				return;
			}

			// Everything logged today, absence included. Vacation and Sick Leave are
			// ordinary time entries now (against the two built-in absence tasks), so
			// a day off accounts for itself and needs no separate approved-time-off
			// lookup: the absence entry alone clears the expected hours below.
			// Fill blocks count too — one means the user deliberately accounted for
			// the rest of the day.
			const entries = await db.query.timeEntry.findMany({
				where: and(
					eq(timeEntry.organizationId, row.organizationId),
					eq(timeEntry.userId, row.userId),
					eq(timeEntry.date, todayKey),
				),
				columns: { durationSeconds: true },
			});
			const loggedSeconds = entries.reduce(
				(total, entry) => total + entry.durationSeconds,
				0,
			);
			if (loggedSeconds >= expectedSeconds) {
				skipped++;
				return;
			}

			const outcome = await notify(
				{ organizationId: row.organizationId, userId: row.userId },
				{
					kind: "log-reminder",
					title: "Don't forget to log your hours",
					body: `You've logged ${formatDuration(loggedSeconds)} of ${formatDuration(
						expectedSeconds,
					)} expected today.`,
					url: `/${row.slug}/time`,
					tag: `log-reminder-${todayKey}`,
				},
			);
			// Claim the day only after a successful send, so a send failure can be
			// retried on the next tick rather than being silently swallowed. A
			// person who turned reminders off delivers nothing and is skipped, not
			// claimed — turning them back on the same day still reminds them.
			if (!wasDelivered(outcome)) {
				skipped++;
				return;
			}
			await notificationsService.markLogReminded(
				row.organizationId,
				row.userId,
				todayKey,
			);
			sent++;
		} catch (error) {
			failed++;
			console.error("[log-reminders] user reminder failed", {
				organizationId: row.organizationId,
				userId: row.userId,
				error,
			});
		}
	};

	// A fixed pool pulling from one cursor, not chunked batches: a batch runs at
	// the speed of its slowest member and leaves the rest of the pool idle.
	let cursor = 0;
	const workers = Array.from(
		{ length: Math.max(1, Math.min(SWEEP_CONCURRENCY, rows.length)) },
		async () => {
			while (cursor < rows.length) {
				const row = rows[cursor++];
				if (!row) continue;
				try {
					await withTimeout(
						checkOne(row),
						PER_USER_TIMEOUT_MS,
						() =>
							new Error(
								`log-reminder check exceeded ${String(PER_USER_TIMEOUT_MS)}ms`,
							),
					);
				} catch (error) {
					// Only a timeout reaches here — `checkOne` handles its own failures.
					// The abandoned check keeps running and is harmless: the day is
					// claimed only after a delivered send.
					failed++;
					console.error("[log-reminders] user check timed out", {
						organizationId: row.organizationId,
						userId: row.userId,
						error,
					});
				}
			}
		},
	);
	await Promise.all(workers);

	return { eligible: rows.length, sent, skipped, failed };
};
