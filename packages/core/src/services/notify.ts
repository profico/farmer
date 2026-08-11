// Telling a person something.
//
// Four places sent notifications and each decided for itself who could be
// contacted, on which channels, and whether the person's preferences applied:
//
//   * the log reminder pushed, and was the only caller that checked a
//     preference at all;
//   * the budget alert wrote its own two-channel fan-out inline, Slack then
//     push, each with a bare `.catch(() => {})`, and consulted no preference;
//   * the Slack reminders sent three different kinds of DM directly;
//   * `notifyUser(userId, payload)` took a bare user id with no organization,
//     so nothing on the push path could check membership even in principle —
//     the caller happened to be iterating members, which is not the same as the
//     rule being enforced.
//
// One function now: `notify(recipient, event)`. The recipient is always an
// (organization, user) pair, so "is this person still in this org?" is asked
// once, on every channel, instead of being a property of who happens to call.
// Which channels a kind uses, and which preference gates it, are a table — the
// place to add a channel is that table plus one adapter, not four call sites.

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { member } from "../db/schema/auth";
import { notificationsService } from "./notifications.service";
import { slackService } from "./slack.service";

export type NotifyChannel = "push" | "slack";

/** Who to tell. Always org-scoped: a notification is something an organization
 *  says to one of its members, and a person who has left is not one. */
export type NotifyRecipient = {
	organizationId: string;
	userId: string;
};

/** What to tell them. One shape for every channel: a push has two lines, Slack
 *  has one and joins them. `title` is optional because a Slack-only kind is
 *  often a single sentence with no headline to hoist — a kind whose channels
 *  include `push` must set it, since a push with no title renders as blank. */
export type NotifyEvent = {
	kind: NotifyKind;
	title?: string;
	body: string;
	/** App-relative deep link, opened when a push is clicked. */
	url?: string;
	/** Push coalescing tag — a second push with the same tag replaces the first
	 *  rather than stacking. */
	tag?: string;
};

/** Which channels actually delivered. Callers count sends; nobody has to guess
 *  from a void return whether anything happened. */
export type NotifyOutcome = Record<NotifyChannel, boolean>;

export type NotifyKind =
	| "log-reminder"
	| "budget-alert"
	| "compliance-nudge"
	| "month-end"
	| "admin-digest"
	| "test";

// The whole policy, in one table. `preference` names the column in
// `notificationSettings` that turns this kind off; null means the kind has no
// opt-out yet, and adding one is a column here plus a column there rather than
// a hunt through the jobs.
const KINDS: Record<
	NotifyKind,
	{
		channels: readonly NotifyChannel[];
		preference: "logReminders" | null;
	}
> = {
	"log-reminder": { channels: ["push"], preference: "logReminders" },
	"budget-alert": { channels: ["slack", "push"], preference: null },
	"compliance-nudge": { channels: ["slack"], preference: null },
	"month-end": { channels: ["slack"], preference: null },
	"admin-digest": { channels: ["slack"], preference: null },
	test: { channels: ["slack"], preference: null },
};

/** A way of reaching someone. Returns whether it delivered; it never throws,
 *  because a dead push endpoint or an uninstalled Slack app must not fail the
 *  decision that triggered the notification. */
export type NotifyAdapter = (
	to: NotifyRecipient,
	event: NotifyEvent,
) => Promise<boolean>;

const pushAdapter: NotifyAdapter = async (to, event) => {
	await notificationsService.sendPush(to.userId, {
		title: event.title ?? "Farmer",
		body: event.body,
		url: event.url,
		tag: event.tag,
	});
	// The push transport prunes dead endpoints and swallows the rest, so it can
	// report that it ran but not how many devices woke up. Reporting "sent"
	// here would be a claim it cannot support.
	return true;
};

const slackAdapter: NotifyAdapter = (to, event) =>
	slackService.sendDm(
		to.organizationId,
		to.userId,
		event.title ? `${event.title}. ${event.body}` : event.body,
	);

let adapters: Record<NotifyChannel, NotifyAdapter> = {
	push: pushAdapter,
	slack: slackAdapter,
};

/** Substitute the wire in tests — the same seam `services/ports.ts` puts in
 *  front of Google Calendar and GitHub. Pass nothing to restore the real ones. */
export const setNotifyAdaptersForTests = (
	overrides?: Partial<Record<NotifyChannel, NotifyAdapter>>,
): void => {
	adapters = { push: pushAdapter, slack: slackAdapter, ...overrides };
};

const NOTHING_SENT: NotifyOutcome = { push: false, slack: false };

/**
 * Tell one member of one organization one thing.
 *
 * Never throws: a notification is a side effect of a decision that has already
 * been made, and a failed send must not undo it. The return value says what
 * actually went out.
 */
export const notify = async (
	to: NotifyRecipient,
	event: NotifyEvent,
): Promise<NotifyOutcome> => {
	const kind = KINDS[event.kind];

	// Membership, on every channel. This is the check the old push path could
	// not make: it was handed a user id with no organization attached.
	const membership = await db.query.member.findFirst({
		where: and(
			eq(member.organizationId, to.organizationId),
			eq(member.userId, to.userId),
		),
		columns: { id: true },
	});
	if (!membership) return { ...NOTHING_SENT };

	if (kind.preference) {
		const settings = await notificationsService.settingsFor(
			to.organizationId,
			to.userId,
		);
		if (!settings[kind.preference]) return { ...NOTHING_SENT };
	}

	const results = await Promise.all(
		kind.channels.map(async (channel) => {
			try {
				return [channel, await adapters[channel](to, event)] as const;
			} catch (error) {
				console.error("[notify] channel failed", {
					channel,
					kind: event.kind,
					organizationId: to.organizationId,
					userId: to.userId,
					error,
				});
				return [channel, false] as const;
			}
		}),
	);

	return { ...NOTHING_SENT, ...Object.fromEntries(results) };
};

/** Whether anything at all reached the person — what the jobs count. */
export const wasDelivered = (outcome: NotifyOutcome): boolean =>
	Object.values(outcome).some(Boolean);
