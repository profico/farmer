import { eq } from "drizzle-orm";
import { db } from "../db";
import { member, organization } from "../db/schema/auth";
import { slackReminderLog } from "../db/schema/slack";
import {
	addDaysToKey,
	dayKeyInTz,
	formatDuration,
	timeKeyInTz,
} from "../lib/time";
import { complianceService } from "../services/compliance.service";
import { holidaysService } from "../services/holidays.service";
import { orgSettingsService, REMINDER_WEEKDAYS } from "../services/org-settings.service";
import { slackService } from "../services/slack.service";
import type { Ctx } from "../services/types";

export type SlackReminderSummary = {
	organizations: number;
	nudges: number;
	monthEnd: number;
	digests: number;
	failed: number;
};

// Slack reminders (PRD §7). Three sends, one job:
//
//   nudge        — Tue and Fri, DM to anyone with no recent entries or behind pace
//   month_end    — last working day of the month, DM to everyone in the cohort
//   admin_digest — Tue, DM to each Admin with the org-wide compliance picture
//
// The cadence is deliberately capped at two nudges a week and is NOT a setting:
// anything more frequent gets muted, and a muted reminder is worse than none.
//
// Idempotency lives in slack_reminder_log, claimed per (org, person, kind, day)
// BEFORE the send. A crash mid-run therefore loses at most one DM rather than
// re-sending the whole batch on the next tick — the safer direction for a
// nag, where a duplicate is more damaging than a miss.

// Nothing goes out before this local time. The scheduler ticks all night, and
// the first tick after midnight is a technically-correct 00:05 DM that nobody
// wants. Not a setting, for the same reason the cadence isn't one.
const EARLIEST_SEND_LOCAL_TIME = "09:00";

/** Claims the (org, user, kind, day) slot. Returns false if already claimed. */
const claim = async (
	organizationId: string,
	recipientUserId: string,
	kind: string,
	dayKey: string,
): Promise<boolean> => {
	const rows = await db
		.insert(slackReminderLog)
		.values({ organizationId, recipientUserId, kind, dayKey })
		.onConflictDoNothing()
		.returning({ id: slackReminderLog.id });
	return rows.length > 0;
};

/** Is `dayKey` the last Mon–Fri non-holiday day of its month? */
const isLastWorkingDayOfMonth = async (ctx: Ctx, dayKey: string) => {
	const month = dayKey.slice(0, 7);
	const holidays = await holidaysService.holidaySetForRange(
		ctx,
		dayKey,
		addDaysToKey(dayKey, 10),
	);
	for (
		let cursor = addDaysToKey(dayKey, 1);
		cursor.slice(0, 7) === month;
		cursor = addDaysToKey(cursor, 1)
	) {
		if (holidays.has(cursor)) continue;
		const weekday = new Date(`${cursor}T00:00:00Z`).getUTCDay();
		if (weekday !== 0 && weekday !== 6) return false;
	}
	return true;
};

export const runSlackRemindersOnce = async (): Promise<SlackReminderSummary> => {
	const now = new Date();
	const orgs = await db
		.select({ id: organization.id, timezone: organization.timezone })
		.from(organization);

	const summary: SlackReminderSummary = {
		organizations: 0,
		nudges: 0,
		monthEnd: 0,
		digests: 0,
		failed: 0,
	};

	for (const org of orgs) {
		// No Slack workspace connected = nothing this job can do, and no reason to
		// run the (fairly expensive) compliance queries for that org at all.
		const installation = await slackService.installationFor(org.id);
		if (!installation) continue;
		summary.organizations++;

		const tz = org.timezone ?? "UTC";
		const today = dayKeyInTz(now, tz);
		const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
		const isReminderDay = (REMINDER_WEEKDAYS as readonly number[]).includes(
			weekday,
		);

		// The job runs unattended, so it needs a ctx to satisfy the service
		// signatures; every call below is explicitly told to skip the admin check
		// because there is no caller to check.
		const ctx: Ctx = { organizationId: org.id, userId: "" };

		if (timeKeyInTz(now, tz) < EARLIEST_SEND_LOCAL_TIME) continue;

		try {
			const isMonthEnd = await isLastWorkingDayOfMonth(ctx, today);
			if (!isReminderDay && !isMonthEnd) continue;

			const [{ noEntries, behindPace }, settings] = await Promise.all([
				complianceService.dashboard(ctx, { skipAdminCheck: true }),
				orgSettingsService.get(ctx),
			]);

			if (isReminderDay) {
				// One DM per person even when they're on both lists — the message
				// leads with whichever problem is worse.
				const messageByUser = new Map<string, string>();
				for (const row of behindPace) {
					messageByUser.set(
						row.userId,
						`You're at ${row.pacePct}% of your expected hours for the month so far — ${formatDuration(
							row.shortfallSeconds,
						)} short. A few minutes now beats reconstructing the month later.`,
					);
				}
				for (const row of noEntries) {
					messageByUser.set(
						row.userId,
						row.lastEntryDate
							? `You haven't logged anything since ${row.lastEntryDate} — that's ${row.workingDaysMissing} working ${
									row.workingDaysMissing === 1 ? "day" : "days"
								}. Worth filling in while you still remember it.`
							: "You haven't logged any time yet. Worth starting today — reconstructing a month from memory is the part everyone hates.",
					);
				}

				for (const [userId, text] of messageByUser) {
					if (!(await claim(org.id, userId, "nudge", today))) continue;
					if (await slackService.sendDm(org.id, userId, text)) summary.nudges++;
				}
			}

			if (isMonthEnd) {
				// The month-end push goes to EVERYONE in the compliance cohort, not
				// just the laggards: the close starts tomorrow, and "I thought I was
				// fine" is exactly the failure this prevents.
				const people = await db
					.select({ userId: member.userId })
					.from(member)
					.where(eq(member.organizationId, org.id));
				const text =
					"Today is the last working day of the month. Anything still unlogged needs to go in before the monthly close starts tomorrow.";
				for (const person of people) {
					if (!(await claim(org.id, person.userId, "month_end", today)))
						continue;
					if (await slackService.sendDm(org.id, person.userId, text))
						summary.monthEnd++;
				}
			}

			// Weekly digest to Admins — Tuesday only, so it doesn't arrive twice.
			if (weekday === REMINDER_WEEKDAYS[0]) {
				const admins = await db
					.select({ userId: member.userId, role: member.role })
					.from(member)
					.where(eq(member.organizationId, org.id));
				const digest = [
					"*Time tracking this week*",
					`• ${noEntries.length} ${noEntries.length === 1 ? "person has" : "people have"} logged nothing in the last ${settings.complianceMissingDays} working days`,
					`• ${behindPace.length} ${behindPace.length === 1 ? "person is" : "people are"} behind pace for the month`,
					...noEntries
						.slice(0, 10)
						.map(
							(r) =>
								`    ${r.name} — ${r.workingDaysMissing} working ${
									r.workingDaysMissing === 1 ? "day" : "days"
								} missing`,
						),
				].join("\n");

				for (const admin of admins) {
					if (admin.role !== "owner" && admin.role !== "admin") continue;
					if (!(await claim(org.id, admin.userId, "admin_digest", today)))
						continue;
					if (await slackService.sendDm(org.id, admin.userId, digest))
						summary.digests++;
				}
			}
		} catch (error) {
			summary.failed++;
			console.error("[slack-reminders] org run failed", {
				organizationId: org.id,
				error,
			});
		}
	}

	return summary;
};
