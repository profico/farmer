// Telling a person something.
//
// Four places sent notifications and each decided for itself who could be
// contacted, on which channels, and whether the person's preferences applied:
//
//   * the log reminder pushed, and was the only caller that checked a
//     preference at all;
//   * the (since removed) budget alert wrote its own two-channel fan-out inline, Slack then
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

import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "../db";
import { account, member } from "../db/schema/auth";
import { notificationSettings } from "../db/schema/notifications";
import { memberProfile } from "../db/schema/people";
import { reminderSettings } from "../db/schema/settings";
import { slackEscape, slackLink } from "../lib/slack-client";
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
	/** The words of the link under a Slack message. A push opens `url` on
	 *  click and has no use for them. */
	linkLabel?: string;
	/** Slack mrkdwn that replaces `title` and `body` on the Slack channel, for
	 *  a message that needs markup no other channel can show — a mention, say.
	 *  `title` and `body` stay the plain form, which is also what the reminder
	 *  preview shows. Whoever builds it escapes what it interpolates. */
	slack?: string;
};

/** Which channels actually delivered. Callers count sends; nobody has to guess
 *  from a void return whether anything happened. */
export type NotifyOutcome = Record<NotifyChannel, boolean>;

export type NotifyKind =
	| "log-reminder"
	| "compliance-nudge"
	| "month-end"
	| "admin-digest"
	| "webhook-disabled"
	| "test";

// The whole policy, in one table. `preference` names the column in
// `notificationSettings` that turns this kind off; null means the kind has no
// opt-out yet, and adding one is a column here plus a column there rather than
// a hunt through the jobs.
//
// `reminder` marks the four scheduled nags about a timesheet. They carry two
// extra gates (see `deliveryBlocks`): nobody archived gets one, and nobody who
// has never signed in unless the org's reminder settings say so. A kind that is
// not a reminder (the test notification) keeps the membership rule alone.
const KINDS = {
	"log-reminder": {
		channels: ["push"],
		preference: "logReminders",
		reminder: true,
	},
	"compliance-nudge": { channels: ["slack"], preference: null, reminder: true },
	"month-end": { channels: ["slack"], preference: null, reminder: true },
	"admin-digest": { channels: ["slack"], preference: null, reminder: true },
	// An outbound endpoint that stopped accepting deliveries (issue #67). Not a
	// reminder: it is a fact about the organization's plumbing, and holding it
	// back from an admin who has never signed in — which is exactly the person
	// an import created and then made an owner — would mean nobody is told.
	// Both channels, because an integration that has gone quiet is the kind of
	// thing that is noticed late.
	"webhook-disabled": {
		channels: ["slack", "push"],
		preference: null,
		reminder: false,
	},
	test: { channels: ["slack"], preference: null, reminder: false },
} satisfies Record<
	NotifyKind,
	{
		channels: readonly NotifyChannel[];
		preference: "logReminders" | null;
		reminder: boolean;
	}
>;

/** Why a person may not be told something. The first one that applies wins,
 *  in this order. */
export type DeliveryBlock =
	| "not-a-member"
	| "archived"
	| "never-signed-in"
	| "opted-out";

/**
 * Who, of `userIds`, may NOT be told a `kind` by this organization, and why. A
 * person absent from the result may be told.
 *
 * `notify` asks this for one person on every send; the reminder preview
 * (`reminderSettingsService.preview`) asks it for a whole list, so "who is held
 * back" on the settings page is this function's answer and not a second copy
 * of it. A fixed number of queries, whatever the length of the list.
 */
export const deliveryBlocks = async (
	organizationId: string,
	userIds: string[],
	kind: NotifyKind,
): Promise<Map<string, DeliveryBlock>> => {
	const blocks = new Map<string, DeliveryBlock>();
	if (userIds.length === 0) return blocks;
	const policy = KINDS[kind];

	const [members, archived, signedIn, settings, optedOut] = await Promise.all([
		db
			.select({ userId: member.userId })
			.from(member)
			.where(
				and(
					eq(member.organizationId, organizationId),
					inArray(member.userId, userIds),
				),
			),
		policy.reminder
			? db
					.select({ userId: memberProfile.userId })
					.from(memberProfile)
					.where(
						and(
							eq(memberProfile.organizationId, organizationId),
							inArray(memberProfile.userId, userIds),
							isNotNull(memberProfile.archivedAt),
						),
					)
			: [],
		// Signed in at least once = has an `account` row. better-auth writes one
		// on the first Google sign-in (and on a dev password signup); a person an
		// import created has a `user` and a `member` row and nothing else.
		policy.reminder
			? db
					.selectDistinct({ userId: account.userId })
					.from(account)
					.where(inArray(account.userId, userIds))
			: [],
		policy.reminder
			? db.query.reminderSettings.findFirst({
					where: eq(reminderSettings.organizationId, organizationId),
					columns: { includeNeverSignedIn: true },
				})
			: undefined,
		policy.preference
			? db
					.select({ userId: notificationSettings.userId })
					.from(notificationSettings)
					.where(
						and(
							eq(notificationSettings.organizationId, organizationId),
							inArray(notificationSettings.userId, userIds),
							eq(notificationSettings[policy.preference], false),
						),
					)
			: [],
	]);

	const memberIds = new Set(members.map((r) => r.userId));
	const archivedIds = new Set(archived.map((r) => r.userId));
	const signedInIds = new Set(signedIn.map((r) => r.userId));
	const optedOutIds = new Set(optedOut.map((r) => r.userId));
	// A missing row is the defaults, and the default is off.
	const includeNeverSignedIn = settings?.includeNeverSignedIn ?? false;

	for (const userId of userIds) {
		if (!memberIds.has(userId)) blocks.set(userId, "not-a-member");
		else if (archivedIds.has(userId)) blocks.set(userId, "archived");
		else if (
			policy.reminder &&
			!includeNeverSignedIn &&
			!signedInIds.has(userId)
		) {
			blocks.set(userId, "never-signed-in");
		} else if (optedOutIds.has(userId)) blocks.set(userId, "opted-out");
	}
	return blocks;
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

/** The Slack text of an event: the title in bold on its own line, the body
 *  under it, and the deep link last. The link is the point — the push channel
 *  always had it, and a DM that says "a few minutes now" with no way to get
 *  there asked the reader to go and find the page. */
export const slackText = (event: NotifyEvent): string => {
	const text =
		event.slack ??
		(event.title
			? `*${slackEscape(event.title)}*\n${slackEscape(event.body)}`
			: slackEscape(event.body));
	const link = event.url
		? slackLink(event.url, event.linkLabel ?? "Open Farmer")
		: null;
	return link ? `${text}\n${link}` : text;
};

const slackAdapter: NotifyAdapter = (to, event) =>
	slackService.sendDm(to.organizationId, to.userId, slackText(event));

let adapters = {
	push: pushAdapter,
	slack: slackAdapter,
} satisfies Record<NotifyChannel, NotifyAdapter>;

/** Substitute the wire in tests — the same seam `services/ports.ts` puts in
 *  front of Google Calendar and GitHub. Pass nothing to restore the real ones. */
export const setNotifyAdaptersForTests = (
	overrides?: Partial<Record<NotifyChannel, NotifyAdapter>>,
): void => {
	adapters = { push: pushAdapter, slack: slackAdapter, ...overrides };
};

const NOTHING_SENT = { push: false, slack: false } satisfies NotifyOutcome;

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

	// Membership, on every channel — the check the old push path could not
	// make, since it was handed a user id with no organization attached — then
	// the reminder gates and the person's own preference.
	const blocks = await deliveryBlocks(
		to.organizationId,
		[to.userId],
		event.kind,
	);
	if (blocks.has(to.userId)) return { ...NOTHING_SENT };

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
