import { and, eq } from "drizzle-orm";

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
// reported by `notify` as `"unreachable"`) — the claim
// is released and the pass is left unfinished, so the next tick tries again,
// at most `MAX_SEND_ATTEMPTS` times a day, after which the claim stays. A
// permanent refusal keeps its claim and counts as neither sent nor failed:
// counting it would add three failures a day per deactivated account.
//
// A refused bot token is neither case: it is about the credential, and every
// send after it fails the same way. `sendDm` records it on the installation
// (`slackService.rejectToken`), so after a failed send the job asks whether
// the org still has Slack. When it does not, the send counts as failed, its
// claim is released like any other failure, and the org's pass ends there
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

/** `${organizationId}:${userId}:${claim}:${dayKey}` → the failed sends so far,
 *  for a reminder whose claim was released to be tried again.
 *
 *  An entry only matters for its own day and only while the person is still
 *  due the reminder, so `pruneFailedAttempts` drops it once either stops being
 *  true. Without that, a person who failed once and then logged their time
 *  kept an entry until the process restarted. */
const failedAttempts = new Map<
	string,
	{
		organizationId: string;
		userId: string;
		claim: string;
		dayKey: string;
		count: number;
	}
>();

/** Drop the org's entries from another day, and — given `claim` and the
 *  people still due it today — those for anyone who left the list. */
const pruneFailedAttempts = (
	organizationId: string,
	today: string,
	still?: { claim: string; userIds: Set<string> },
): void => {
	for (const [key, entry] of failedAttempts) {
		if (entry.organizationId !== organizationId) continue;
		const stale =
			entry.dayKey !== today ||
			(still !== undefined &&
				entry.claim === still.claim &&
				!still.userIds.has(entry.userId));
		if (stale) failedAttempts.delete(key);
	}
};

/** How many attempt records the job holds. For a test to see the pruning. */
export const slackReminderAttemptsForTests = (): number => failedAttempts.size;

/** Forget which passes already ran, so a test can run the same day twice. */
export const forgetSlackReminderRunsForTests = (): void => {
	finishedRuns.clear();
	failedAttempts.clear();
};

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

/** Gives a claimed slot back, so the next tick may try the send again. */
const releaseClaim = async (
	organizationId: string,
	recipientUserId: string,
	kind: string,
	dayKey: string,
): Promise<void> => {
	await db
		.delete(slackReminderLog)
		.where(
			and(
				eq(slackReminderLog.organizationId, organizationId),
				eq(slackReminderLog.recipientUserId, recipientUserId),
				eq(slackReminderLog.kind, kind),
				eq(slackReminderLog.dayKey, dayKey),
			),
		);
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
		// Before the installation check, so an org that disconnected Slack does
		// not keep yesterday's records either.
		pruneFailedAttempts(org.id, today);

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
				pruneFailedAttempts(org.id, today, {
					claim: entry.claim,
					userIds: new Set(
						recipients
							.map((r) => r.userId)
							.filter((userId) => !blocks.has(userId)),
					),
				});
				let retryLater = false;
				let slackLost = false;
				for (const recipient of recipients) {
					if (blocks.has(recipient.userId)) continue;
					if (!(await claim(org.id, recipient.userId, entry.claim, today))) {
						continue;
					}
					const attemptKey = `${org.id}:${recipient.userId}:${entry.claim}:${today}`;
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
					if (result !== "failed") {
						failedAttempts.delete(attemptKey);
						continue;
					}

					summary.failed++;
					slackLost = !(await slackService.installationFor(org.id));
					const attempts = (failedAttempts.get(attemptKey)?.count ?? 0) + 1;
					if (attempts >= MAX_SEND_ATTEMPTS) {
						// Out of attempts: the claim stays, and the day gets no more.
						failedAttempts.delete(attemptKey);
						if (slackLost) break;
						continue;
					}
					failedAttempts.set(attemptKey, {
						organizationId: org.id,
						userId: recipient.userId,
						claim: entry.claim,
						dayKey: today,
						count: attempts,
					});
					try {
						await releaseClaim(org.id, recipient.userId, entry.claim, today);
						retryLater = true;
					} catch (error) {
						// The claim stays, so this is a miss, never a duplicate.
						console.error("[slack-reminders] could not release a claim", {
							organizationId: org.id,
							userId: recipient.userId,
							kind: entry.kind,
							error,
						});
					}
					if (slackLost) break;
				}
				// No Slack left to send with: stop the org, and leave every kind
				// unfinished so a new install today still sends.
				if (slackLost) break;
				// A released claim needs this kind's pass to run again next tick.
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
