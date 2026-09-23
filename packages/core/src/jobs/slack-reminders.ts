import { and, eq, sql } from "drizzle-orm";

import { db } from "../db";
import { organization } from "../db/schema/auth";
import { slackReminderLog } from "../db/schema/slack";
import { dayKeyInTz, timeKeyInTz } from "../lib/time";
import type { ReminderKind } from "../schema/reminder-settings";
import {
	deliveryBlocks,
	notify,
	wasDelivered,
	wasUnreachable,
} from "../services/notify";
import {
	dashboardLoader,
	isMonthEndDay,
	reminderDayCheck,
	reminderRecipients,
	sendTimeReached,
} from "../services/reminder-recipients";
import { reminderSettingsService } from "../services/reminder-settings.service";
import { slackService } from "../services/slack.service";
import type { Ctx } from "../services/types";

export type SlackReminderSummary = {
	organizations: number;
	nudges: number;
	monthEnd: number;
	digests: number;
	failed: number;
};

// Slack reminders (PRD §7). Three sends, one job, each on the org's own
// schedule from `reminder_settings` (Settings → Reminders):
//
//   nudge        — on the nudge days (Tue and Fri by default), DM to anyone
//                  with no recent entries or behind pace
//   month_end    — on the last working day of the month (or N before it), DM
//                  to everyone in the cohort
//   admin_digest — on the digest day (Tue), DM to each Admin with the org-wide
//                  compliance picture
//
// The cadence used to be two fixed nudges a week and NOT a setting, because
// anything more frequent gets muted and a muted reminder is worse than none.
// It is a setting now, and that reason is kept as limits instead: at most three
// nudge days a week and no send time at night, in the schema and in a database
// check. Who gets what is `services/reminder-recipients.ts`, shared with the
// settings page's preview.
//
// Idempotency lives in slack_reminder_log, claimed per (org, person, kind, day)
// BEFORE the send. A crash mid-run therefore loses at most one DM rather than
// re-sending the whole batch on the next tick — the safer direction for a
// nag, where a duplicate is more damaging than a miss.
//
// A send that comes back undelivered is a different case: nothing went out,
// so the claim only stood between the person and a retry. Unless no retry can
// help — they have no Slack identity, or Slack refused for good (a deactivated
// account, an unknown user: `RECIPIENT_REFUSALS` in `lib/slack-client.ts`,
// reported by `notify` as `"unreachable"`) — the claim row is marked for a
// retry and the pass is left unfinished, so the next tick claims it again, at
// most `MAX_SEND_ATTEMPTS` times a day, after which the claim stays. The count
// is on the row (`attempts`), so a restart does not start it again. A
// permanent refusal keeps its claim and counts as neither sent nor failed:
// counting it would add three failures a day per deactivated account.
//
// A refused bot token is neither case: it is about the credential, and every
// send after it fails the same way. `sendDm` records it on the installation
// (`slackService.rejectToken`), so after a failed send the job asks whether
// the org still has Slack. When it does not, the send counts as failed, its
// claim is marked for a retry like any other failure, and the org's pass ends there
// rather than claiming and failing the rest of the list. Settings shows the
// reconnect state, and a new install reaches everyone the same day.

/** The three kinds this job sends, the claim key each has always used in
 *  `slack_reminder_log`, and the summary counter it adds to. */
const SLACK_KINDS = [
	{ kind: "compliance-nudge", claim: "nudge", counter: "nudges" },
	{ kind: "month-end", claim: "month_end", counter: "monthEnd" },
	{ kind: "admin-digest", claim: "admin_digest", counter: "digests" },
] as const satisfies readonly {
	kind: ReminderKind;
	claim: string;
	counter: keyof SlackReminderSummary;
}[];

/** `${organizationId}:${kind}` → the day key this process last finished that
 *  kind's pass for.
 *
 *  The job ticks every 15 minutes now, so a send time can be any quarter hour.
 *  Without this, every tick after the send time on a reminder day would run the
 *  compliance queries again only for the claims to refuse every DM they chose.
 *  In memory rather than read off `slack_reminder_log`: a claim row says one
 *  person was reached, not that the pass finished, and a pass that crashed
 *  half-way must get its second half on the next tick. A restart costs one
 *  more pass per org and kind, which the claims make harmless. */
const finishedRuns = new Map<string, string>();

/** How many times one reminder is tried on one day before the job gives up. */
const MAX_SEND_ATTEMPTS = 3;

/** Forget which passes already ran, so a test can run the same day twice. */
export const forgetSlackReminderRunsForTests = (): void => {
	finishedRuns.clear();
};

/** The key of one reminder: `slack_reminder_log`'s unique constraint. */
type ClaimKey = {
	organizationId: string;
	recipientUserId: string;
	kind: string;
	dayKey: string;
};

const claimWhere = (key: ClaimKey) =>
	and(
		eq(slackReminderLog.organizationId, key.organizationId),
		eq(slackReminderLog.recipientUserId, key.recipientUserId),
		eq(slackReminderLog.kind, key.kind),
		eq(slackReminderLog.dayKey, key.dayKey),
	);

/** Claims the (org, user, kind, day) slot: a new row, or one a failed send
 *  marked for a retry. Returns which attempt this is, or null when the slot
 *  is settled. */
const claim = async (key: ClaimKey): Promise<number | null> => {
	const rows = await db
		.insert(slackReminderLog)
		.values(key)
		.onConflictDoUpdate({
			target: [
				slackReminderLog.organizationId,
				slackReminderLog.recipientUserId,
				slackReminderLog.kind,
				slackReminderLog.dayKey,
			],
			set: { attempts: sql`${slackReminderLog.attempts} + 1`, retry: false },
			setWhere: eq(slackReminderLog.retry, true),
		})
		.returning({ attempts: slackReminderLog.attempts });
	return rows[0]?.attempts ?? null;
};

/** Lets the next tick claim the slot again. */
const markForRetry = async (key: ClaimKey): Promise<void> => {
	await db.update(slackReminderLog).set({ retry: true }).where(claimWhere(key));
};

/** Is `dayKey` the last Mon–Fri non-holiday day of its month? The month-end
 *  reminder's default day; `isMonthEndDay` is the general form and carries the
 *  history of why both halves of the question matter. */
export const isLastWorkingDayOfMonth = (ctx: Ctx, dayKey: string) =>
	isMonthEndDay(ctx, dayKey, 0);

export const runSlackRemindersOnce = async (
	opts: { now?: Date } = {},
): Promise<SlackReminderSummary> => {
	const now = opts.now ?? new Date();
	const orgs = await db
		.select({
			id: organization.id,
			slug: organization.slug,
			timezone: organization.timezone,
		})
		.from(organization);

	const summary: SlackReminderSummary = {
		organizations: 0,
		nudges: 0,
		monthEnd: 0,
		digests: 0,
		failed: 0,
	};

	for (const org of orgs) {
		const tz = org.timezone ?? "UTC";
		const today = dayKeyInTz(now, tz);
		const timeKey = timeKeyInTz(now, tz);

		// No Slack workspace connected = nothing this job can do, and no reason to
		// run the (fairly expensive) compliance queries for that org at all.
		const installation = await slackService.installationFor(org.id);
		if (!installation) continue;
		summary.organizations++;

		// The job runs unattended, so it needs a ctx to satisfy the service
		// signatures; nothing below checks a caller, because there is none.
		const ctx: Ctx = { organizationId: org.id, userId: "" };

		try {
			const settings = await reminderSettingsService.get(ctx);

			// The fast check, before any compliance query: what this process
			// already finished today, then the send time, then the day. Only the
			// month-end day costs a query (the holiday calendar), and it runs
			// last. Most ticks end here.
			const due: (typeof SLACK_KINDS)[number][] = [];
			for (const entry of SLACK_KINDS) {
				if (finishedRuns.get(`${org.id}:${entry.kind}`) === today) continue;
				if (!sendTimeReached(settings, entry.kind, timeKey)) continue;
				if (await reminderDayCheck(ctx, settings, entry.kind, today)) continue;
				due.push(entry);
			}
			if (due.length === 0) continue;

			const dashboard = dashboardLoader(ctx, settings, now);
			const moment = { dayKey: today, timeKey, tz, now, slug: org.slug };
			for (const entry of due) {
				const recipients = await reminderRecipients(
					ctx,
					settings,
					entry.kind,
					moment,
					dashboard,
				);
				// `notify` applies these gates anyway. Asking first keeps a held-back
				// person from spending the day's claim, so turning "include people
				// who never signed in" on still reaches them the same day.
				const blocks = await deliveryBlocks(
					org.id,
					recipients.map((r) => r.userId),
					entry.kind,
				);
				let retryLater = false;
				let slackLost = false;
				for (const recipient of recipients) {
					if (blocks.has(recipient.userId)) continue;
					const key: ClaimKey = {
						organizationId: org.id,
						recipientUserId: recipient.userId,
						kind: entry.claim,
						dayKey: today,
					};
					const attempt = await claim(key);
					if (attempt === null) continue;
					let result: "delivered" | "unreachable" | "failed";
					try {
						const outcome = await notify(
							{ organizationId: org.id, userId: recipient.userId },
							recipient.event,
						);
						if (wasDelivered(outcome)) result = "delivered";
						else if (wasUnreachable(outcome)) result = "unreachable";
						else {
							// No Slack identity is not a failure a retry can fix: keep the
							// claim, as before.
							const slackId = await slackService.slackIdFor(
								org.id,
								recipient.userId,
							);
							result = slackId ? "failed" : "unreachable";
						}
					} catch (error) {
						console.error("[slack-reminders] send failed", {
							organizationId: org.id,
							userId: recipient.userId,
							kind: entry.kind,
							error,
						});
						result = "failed";
					}

					if (result === "delivered") summary[entry.counter]++;
					if (result !== "failed") continue;

					summary.failed++;
					slackLost = !(await slackService.installationFor(org.id));
					// Out of attempts: the claim stays settled, and the day gets no more.
					if (attempt < MAX_SEND_ATTEMPTS) {
						try {
							await markForRetry(key);
							retryLater = true;
						} catch (error) {
							// The claim stays settled, so this is a miss, never a duplicate.
							console.error("[slack-reminders] could not mark a retry", {
								organizationId: org.id,
								userId: recipient.userId,
								kind: entry.kind,
								error,
							});
						}
					}
					if (slackLost) break;
				}
				// No Slack left to send with: stop the org, and leave every kind
				// unfinished so a new install today still sends.
				if (slackLost) break;
				// A claim marked for a retry needs this kind's pass to run again.
				if (!retryLater) finishedRuns.set(`${org.id}:${entry.kind}`, today);
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
