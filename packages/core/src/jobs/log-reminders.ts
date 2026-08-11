import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { member, organization } from "../db/schema/auth";
import { timeEntry } from "../db/schema/domain";
import {
	dayKeyInTz,
	formatDuration,
	timeKeyInTz,
	weekdayInTz,
} from "../lib/time";
import { dayDurationSeconds, dayForWeekday } from "../lib/working-day";
import { holidaysService } from "../services/holidays.service";
import { notificationsService } from "../services/notifications.service";
import { workingHoursService } from "../services/working-hours.service";
import type { Ctx } from "../services/types";

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

	for (const row of rows) {
		const ctx: Ctx = {
			organizationId: row.organizationId,
			userId: row.userId,
		};
		try {
			const tz = row.timezone ?? "UTC";
			const todayKey = dayKeyInTz(now, tz);

			// Preference gate (missing row = default ON).
			const settings = await notificationsService.settingsFor(
				row.organizationId,
				row.userId,
			);
			if (!settings.logReminders) {
				skipped++;
				continue;
			}

			// Already reminded for this day?
			const lastReminded = await notificationsService.lastLogReminderDay(
				row.organizationId,
				row.userId,
			);
			if (lastReminded === todayKey) {
				skipped++;
				continue;
			}

			// A scheduled working day with a defined end time, and the day is over.
			const workingHours = await workingHoursService.list(ctx);
			const day = dayForWeekday(workingHours, weekdayInTz(todayKey, tz));
			const expectedSeconds = day ? dayDurationSeconds(day) : 0;
			if (expectedSeconds <= 0 || !day?.endTime) {
				skipped++;
				continue;
			}
			// Only nag once the scheduled workday has ended (both "HH:mm", org tz).
			if (timeKeyInTz(now, tz) < day.endTime) {
				skipped++;
				continue;
			}

			// Not on an org holiday.
			const holidays = await holidaysService.holidaySetForRange(
				ctx,
				todayKey,
				todayKey,
			);
			if (holidays.has(todayKey)) {
				skipped++;
				continue;
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
				continue;
			}

			await notificationsService.notifyUser(row.userId, {
				title: "Don't forget to log your hours",
				body: `You've logged ${formatDuration(loggedSeconds)} of ${formatDuration(
					expectedSeconds,
				)} expected today.`,
				url: `/${row.slug}/time`,
				tag: `log-reminder-${todayKey}`,
			});
			// Claim the day only after a successful send, so a send failure can be
			// retried on the next tick rather than being silently swallowed.
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
	}

	return { eligible: rows.length, sent, skipped, failed };
};
