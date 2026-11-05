import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization } from "../db/schema/auth";
import { notificationSettings } from "../db/schema/notifications";
import { durationFromEnv, withTimeout } from "../lib/http";
import { loggableError } from "../lib/loggable-error";
import { dayKeyInTz, timeKeyInTz } from "../lib/time";
import { notificationsService } from "../services/notifications.service";
import { deliveryBlocks, notify, wasDelivered } from "../services/notify";
import {
	dashboardLoader,
	type ReminderRecipient,
	reminderRecipients,
	sendTimeReached,
} from "../services/reminder-recipients";
import { reminderSettingsService } from "../services/reminder-settings.service";
import type { Ctx } from "../services/types";

export type LogReminderSummary = {
	eligible: number;
	sent: number;
	skipped: number;
	failed: number;
};

// The "you forgot to log" push. Runs on a timer (see jobs/scheduler.ts) and,
// for every member, fires a single push once their send time has come IF they
// are under the org's share of their expected hours for the day. The send time
// is the end of their own scheduled workday by default, or a fixed time for the
// whole org (Settings → Reminders).
//
// Idempotent by construction: notificationSettings.lastLogReminderDay records
// the org-day-key we last reminded each user, so overlapping ticks and process
// restarts never double-send. A user is skipped (never reminded) when:
//   - the org turned the log reminder off,
//   - today isn't a scheduled working day for them (or has no end time),
//   - the send time hasn't come yet in the org timezone,
//   - today is an org holiday,
//   - they've already logged the configured share of their expected hours,
//   - `notify` would hold them back: they left, are archived, have never
//     signed in (unless the org includes them), or turned log reminders off.
//     The job asks `deliveryBlocks` for the whole org first and drops them,
//     so they cost nothing per person.
//
// Who is reminded is `services/reminder-recipients.ts`, the same function the
// settings page previews with — one query for each fact for a whole org, where
// this used to issue four for each person.
//
// Best-effort per user: one failure is logged and skipped, never aborts the run.

/** How many pushes go out at once, and how long one person's send may take.
 *  The same shape as the automation sweep (jobs/automation-sync.ts) and for
 *  the same reason: nothing else bounds a pass, and one wedged send must
 *  degrade the sweep rather than end it. */
const SWEEP_CONCURRENCY = Number(process.env.LOG_REMINDERS_CONCURRENCY ?? 4);
const PER_USER_TIMEOUT_MS = durationFromEnv(
	process.env.LOG_REMINDERS_USER_TIMEOUT_MS,
	30_000,
);

/** People per delivery-gate read. Each read is one `in` list, and PGLite (the
 *  tests) fails a statement with a few thousand parameters. */
const GATE_BATCH = 500;

/** `${organizationId}:${userId}:${dayKey}` of every send still running.
 *
 *  A send that overruns its deadline is abandoned by the sweep, not stopped:
 *  it keeps running, and the day is claimed only once it delivers. The next
 *  tick saw no claim yet and sent a second reminder beside the first. So a
 *  person stays here until their send settles, and a tick skips them while
 *  they are, whatever the deadline did. Module-level because the ticks that
 *  would overlap are separate calls. */
const sendsInFlight = new Set<string>();

type OrgRun = {
	organizationId: string;
	slug: string;
	tz: string;
	userIds: string[];
};

export const runLogRemindersOnce = async (
	opts: { now?: Date } = {},
): Promise<LogReminderSummary> => {
	const now = opts.now ?? new Date();

	const rows = await db
		.select({
			userId: member.userId,
			organizationId: member.organizationId,
			slug: organization.slug,
			timezone: organization.timezone,
		})
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId));

	const orgs = new Map<string, OrgRun>();
	for (const row of rows) {
		const run = orgs.get(row.organizationId) ?? {
			organizationId: row.organizationId,
			slug: row.slug,
			tz: row.timezone ?? "UTC",
			userIds: [],
		};
		run.userIds.push(row.userId);
		orgs.set(row.organizationId, run);
	}

	let sent = 0;
	let skipped = 0;
	let failed = 0;

	const sendOne = async (
		run: OrgRun,
		todayKey: string,
		recipient: ReminderRecipient,
	) => {
		try {
			const outcome = await notify(
				{ organizationId: run.organizationId, userId: recipient.userId },
				recipient.event,
			);
			// Claim the day only after a successful send, so a send failure can be
			// retried on the next tick rather than being silently swallowed. A
			// person `notify` held back delivers nothing and is skipped, not
			// claimed — turning reminders back on the same day still reminds them.
			if (!wasDelivered(outcome)) {
				skipped++;
				return;
			}
			await notificationsService.markLogReminded(
				run.organizationId,
				recipient.userId,
				todayKey,
			);
			sent++;
		} catch (error) {
			failed++;
			console.error("[log-reminders] user reminder failed", {
				organizationId: run.organizationId,
				userId: recipient.userId,
				error: loggableError(error),
			});
		}
	};

	for (const run of orgs.values()) {
		const ctx: Ctx = { organizationId: run.organizationId, userId: "" };
		const todayKey = dayKeyInTz(now, run.tz);
		const timeKey = timeKeyInTz(now, run.tz);

		let recipients: ReminderRecipient[];
		try {
			const settings = await reminderSettingsService.get(ctx);
			if (
				!settings.logEnabled ||
				!sendTimeReached(settings, "log-reminder", timeKey)
			) {
				skipped += run.userIds.length;
				continue;
			}

			// Already reminded for this day?
			const reminded = await db
				.select({ userId: notificationSettings.userId })
				.from(notificationSettings)
				.where(
					and(
						eq(notificationSettings.organizationId, run.organizationId),
						eq(notificationSettings.lastLogReminderDay, todayKey),
					),
				);
			const remindedIds = new Set(reminded.map((r) => r.userId));
			const unreminded = run.userIds.filter((id) => !remindedIds.has(id));

			// Drop everyone `notify` would hold back — archived, never signed in,
			// opted out — with one batched read for the org, as the Slack job
			// does. Left to `notify`, each of them cost its five gate queries on
			// every tick of the day, for a send that could never happen: after a
			// history import that is dozens of archived people. The preview drops
			// the same people with the same function, so the two still agree.
			const blocked = new Set<string>();
			for (let i = 0; i < unreminded.length; i += GATE_BATCH) {
				const blocks = await deliveryBlocks(
					run.organizationId,
					unreminded.slice(i, i + GATE_BATCH),
					"log-reminder",
				);
				for (const userId of blocks.keys()) blocked.add(userId);
			}
			const pending = unreminded.filter((id) => !blocked.has(id));
			if (pending.length === 0) {
				skipped += run.userIds.length;
				continue;
			}

			recipients = await reminderRecipients(
				ctx,
				settings,
				"log-reminder",
				{ dayKey: todayKey, timeKey, tz: run.tz, now, slug: run.slug },
				dashboardLoader(ctx, settings, now),
				pending,
			);
			skipped += run.userIds.length - recipients.length;
		} catch (error) {
			failed += run.userIds.length;
			console.error("[log-reminders] org pass failed", {
				organizationId: run.organizationId,
				error: loggableError(error),
			});
			continue;
		}

		// A fixed pool pulling from one cursor, not chunked batches: a batch runs
		// at the speed of its slowest member and leaves the rest of the pool idle.
		let cursor = 0;
		const workers = Array.from(
			{ length: Math.max(1, Math.min(SWEEP_CONCURRENCY, recipients.length)) },
			async () => {
				while (cursor < recipients.length) {
					const recipient = recipients[cursor++];
					if (!recipient) continue;
					const flightKey = `${run.organizationId}:${recipient.userId}:${todayKey}`;
					if (sendsInFlight.has(flightKey)) {
						skipped++;
						continue;
					}
					sendsInFlight.add(flightKey);
					const send = sendOne(run, todayKey, recipient).finally(() => {
						sendsInFlight.delete(flightKey);
					});
					try {
						await withTimeout(
							send,
							PER_USER_TIMEOUT_MS,
							() =>
								new Error(
									`log-reminder send exceeded ${String(PER_USER_TIMEOUT_MS)}ms`,
								),
						);
					} catch (error) {
						// Only a timeout reaches here — `sendOne` handles its own
						// failures. The abandoned send keeps running, and the person stays
						// in `sendsInFlight` until it settles, so no tick sends again.
						failed++;
						console.error("[log-reminders] user send timed out", {
							organizationId: run.organizationId,
							userId: recipient.userId,
							error,
						});
					}
				}
			},
		);
		await Promise.all(workers);
	}

	return { eligible: rows.length, sent, skipped, failed };
};
