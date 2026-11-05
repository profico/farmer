import { and, eq, inArray, isNull, lt } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { memberProfile } from "../db/schema/people";
import {
	memberSlackIdentity,
	slackInstallation,
	slackPing,
} from "../db/schema/slack";
import { setting } from "../lib/instance-settings";
import { loggableError } from "../lib/loggable-error";
import { signOrgState } from "../lib/oauth-state";
import { openAndHeal, sealSecret } from "../lib/secret-box";
import {
	SLACK_BOT_SCOPES,
	slackClient,
	slackEscape,
	slackLink,
	slackRedirectUri,
} from "../lib/slack-client";
import { dayKeyInTz } from "../lib/time";
import { UserFacingError } from "../lib/user-facing-error";
import { accessService } from "./access.service";
import { recordAudit } from "./audit";
import { complianceService } from "./compliance.service";
import { ctxAccess, ctxTimezone, requireAdmin } from "./context";
import type { Ctx } from "./types";

/** How long a person is left alone after a ping. */
export const PING_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** A ping was refused because the person got one less than 24 hours ago. */
export class PingTooSoonError extends UserFacingError {
	constructor() {
		super("This person was pinged less than 24 hours ago.");
		this.name = "PingTooSoonError";
	}
}

/** The row of the person to ping, when the caller may see it and it is behind.
 *  Reads the Tracking report, so the caller's scope and the verdict are the
 *  ones the report shows. */
const behindRowFor = async (ctx: Ctx, userId: string, now: Date) => {
	const [year, month] = dayKeyInTz(now, await ctxTimezone(ctx))
		.split("-")
		.map(Number);
	const report = await complianceService.tracking(
		ctx,
		{ year: year ?? 0, month: month ?? 0 },
		{ now },
	);
	const row = report.rows.find((r) => r.userId === userId);
	if (!row) throw new UserFacingError("You cannot see this person.");
	if (row.status === null || row.status === "on_track") {
		throw new UserFacingError("This person is not behind their target.");
	}
	return row;
};

/** Take the right to ping, or throw. One statement: the conflict update only
 *  applies to a stored ping older than the cooldown, so two callers at once
 *  cannot both pass. */
const claimPing = async (ctx: Ctx, userId: string, now: Date) => {
	const claimed = await db
		.insert(slackPing)
		.values({
			organizationId: ctx.organizationId,
			userId,
			pingedByUserId: ctx.userId,
			pingedAt: now,
		})
		.onConflictDoUpdate({
			target: [slackPing.organizationId, slackPing.userId],
			set: { pingedByUserId: ctx.userId, pingedAt: now },
			setWhere: lt(
				slackPing.pingedAt,
				new Date(now.getTime() - PING_COOLDOWN_MS),
			),
		})
		.returning({ id: slackPing.id });
	if (claimed.length === 0) throw new PingTooSoonError();
};

const sendPing = async (ctx: Ctx, userId: string) => {
	const [sender, org] = await Promise.all([
		db.query.user.findFirst({
			where: eq(user.id, ctx.userId),
			columns: { name: true },
		}),
		db.query.organization.findFirst({
			where: eq(organization.id, ctx.organizationId),
			columns: { slug: true },
		}),
	]);
	// Imported here, not at the top: `notify` imports this module for its Slack
	// adapter, and a static cycle would leave one of the two in its temporal
	// dead zone at call time (the same reason `sendTest` does it).
	const { notify, wasDelivered, wasUnreachable } = await import("./notify");
	const outcome = await notify(
		{ organizationId: ctx.organizationId, userId },
		{
			kind: "ping",
			title: "Please track your time",
			body: `${sender?.name ?? "A colleague"} asks you to track your time. You are behind your target for this month.`,
			url: org ? `/${org.slug}/time` : undefined,
		},
	);
	if (wasDelivered(outcome)) return "sent";
	return wasUnreachable(outcome) ? "unreachable" : "failed";
};

/** The people of `userIds` that a ping cannot reach (not yet a member, archived,
 *  never signed in). Imported here for the same cycle reason as `sendPing`. */
const pingBlocked = async (organizationId: string, userIds: string[]) => {
	const { deliveryBlocks } = await import("./notify");
	return deliveryBlocks(organizationId, userIds, "ping");
};

const releasePing = (ctx: Ctx, userId: string) =>
	db
		.delete(slackPing)
		.where(
			and(
				eq(slackPing.organizationId, ctx.organizationId),
				eq(slackPing.userId, userId),
			),
		);

const CANNOT_REACH = "This person cannot be reached on Slack.";

export const slackService = {
	/** Connection status for the Settings screen. Never returns the bot token —
	 *  it is a workspace-wide credential and no client has any use for it.
	 *
	 *  Reads through `installationFor`, the same door every send goes through,
	 *  so it cannot say "Connected" to a token nothing can use. A row whose token
	 *  does not decrypt (a changed BETTER_AUTH_SECRET) or that Slack refused
	 *  (`tokenRejectedAt`) is `needsReconnect`: no DM goes out and the reminder
	 *  job skips the org, and this screen is the one place that can tell an
	 *  admin to install again. `reason` says which, for the message. */
	status: async (ctx: Ctx) => {
		await requireAdmin(ctx);
		const installation = await slackService.installationFor(ctx.organizationId);
		if (!installation) {
			const stale = await db.query.slackInstallation.findFirst({
				where: eq(slackInstallation.organizationId, ctx.organizationId),
				columns: { teamName: true, tokenRejectedAt: true },
			});
			return stale
				? {
						connected: false as const,
						needsReconnect: true as const,
						reason: stale.tokenRejectedAt
							? ("rejected" as const)
							: ("unreadable" as const),
						teamName: stale.teamName,
					}
				: { connected: false as const, needsReconnect: false as const };
		}
		const identities = await db
			.select({ userId: memberSlackIdentity.userId })
			.from(memberSlackIdentity)
			.where(eq(memberSlackIdentity.organizationId, ctx.organizationId));

		return {
			connected: true as const,
			needsReconnect: false as const,
			teamId: installation.teamId,
			teamName: installation.teamName,
			connectedAt: installation.createdAt,
			mappedPeople: identities.length,
		};
	},

	/**
	 * The "Add to Slack" URL. The org id is signed into `state` so the callback
	 * can attach the install to the org the admin started from, even if their
	 * active org changed in another tab meanwhile — the same guarantee the GitHub
	 * App setup redirect relies on.
	 */
	installUrl: async (ctx: Ctx) => {
		await requireAdmin(ctx);
		const clientId = setting("SLACK_CLIENT_ID");
		if (!clientId) throw new Error("SLACK_CLIENT_ID not configured");

		const url = new URL("https://slack.com/oauth/v2/authorize");
		url.searchParams.set("client_id", clientId);
		url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
		url.searchParams.set("redirect_uri", slackRedirectUri());
		url.searchParams.set("state", signOrgState(ctx.organizationId, ctx.userId));
		return { url: url.toString() };
	},

	/**
	 * Finish the OAuth v2 install: trade the one-time `code` for a bot token and
	 * store it, then resolve everyone's Slack id by email in the same pass so
	 * reminders work immediately rather than after the next nightly tick.
	 *
	 * Upserts on organizationId, so re-installing (to add a scope, or after
	 * someone removed the app in Slack) replaces the credential in place instead
	 * of failing on the unique constraint.
	 */
	completeInstall: async (ctx: Ctx, code: string) => {
		await requireAdmin(ctx);

		const result = await slackClient.exchangeOAuthCode(code);
		const teamName = result.team.name ?? null;
		// Sealed at rest (`lib/secret-box.ts`); only `installationFor` opens it.
		const botToken = sealSecret(result.access_token);

		await db
			.insert(slackInstallation)
			.values({
				organizationId: ctx.organizationId,
				teamId: result.team.id,
				teamName,
				botToken,
				botUserId: result.bot_user_id,
				installedByUserId: ctx.userId,
			})
			.onConflictDoUpdate({
				target: slackInstallation.organizationId,
				set: {
					teamId: result.team.id,
					teamName,
					botToken,
					botUserId: result.bot_user_id,
					installedByUserId: ctx.userId,
					tokenRejectedAt: null,
					updatedAt: new Date(),
				},
			});

		await recordAudit(ctx, {
			kind: "slack.connected",
			target: { type: "slack_workspace", id: result.team.id, label: teamName },
		});
		const mapped = await slackService.syncIdentities(ctx);
		return { teamName, mapped };
	},

	disconnect: async (ctx: Ctx) => {
		await requireAdmin(ctx);
		const removed = await db
			.delete(slackInstallation)
			.where(eq(slackInstallation.organizationId, ctx.organizationId))
			.returning({
				teamId: slackInstallation.teamId,
				teamName: slackInstallation.teamName,
			});
		await db
			.delete(memberSlackIdentity)
			.where(eq(memberSlackIdentity.organizationId, ctx.organizationId));
		for (const row of removed) {
			await recordAudit(ctx, {
				kind: "slack.disconnected",
				target: {
					type: "slack_workspace",
					id: row.teamId,
					label: row.teamName,
				},
			});
		}
	},

	/**
	 * Resolve ONE person's Slack id from their email and record it.
	 *
	 * Takes raw ids rather than a Ctx, and asks for no authorization, because the
	 * caller that matters is not an admin: it's the `member.create` hook, running
	 * inside the invitation the new member just accepted for themselves. The
	 * privilege here is the workspace bot token, which the org already granted —
	 * looking a member up by their own email adds none.
	 *
	 * Returns whether the person was found in the workspace. Never throws: joining
	 * an organization must not fail because Slack is down, uninstalled, or the
	 * person simply isn't in the workspace.
	 */
	linkMember: async (
		organizationId: string,
		userId: string,
	): Promise<boolean> => {
		try {
			const installation = await slackService.installationFor(organizationId);
			if (!installation) return false;

			const person = await db.query.user.findFirst({
				where: eq(user.id, userId),
				columns: { email: true },
			});
			if (!person) return false;

			const slackUserId = await slackClient.lookupUserByEmail(
				installation.botToken,
				person.email,
			);
			if (!slackUserId) return false;

			await db
				.insert(memberSlackIdentity)
				.values({ organizationId, userId, slackUserId })
				.onConflictDoUpdate({
					target: [
						memberSlackIdentity.organizationId,
						memberSlackIdentity.userId,
					],
					set: { slackUserId, updatedAt: new Date() },
				});
			return true;
		} catch (error) {
			console.error("[slack] could not match new member", {
				organizationId,
				userId,
				error: loggableError(error),
			});
			return false;
		}
	},

	/** Re-resolve every member's Slack id from their email. Safe to re-run; people
	 *  who aren't in the workspace are skipped rather than failing the run.
	 *
	 *  Joining is handled on its own by the `member.create` hook (see
	 *  `linkMember`), so this is no longer the way somebody new gets matched. It
	 *  stays for the case the hook cannot cover: a member who was already in the
	 *  organization before they were in the Slack workspace. Nothing about joining
	 *  Slack reaches this app, so that match can only be made by asking again.
	 *
	 *  Archived people are skipped. They never get a reminder, and after a Harvest
	 *  import they are most of the roster: they made the majority of the lookups,
	 *  one Slack call each, in a request that has to answer before the host's idle
	 *  timeout. A match they already have is kept, so restoring one needs no
	 *  re-match unless their Slack account changed. */
	syncIdentities: async (ctx: Ctx): Promise<number> => {
		await requireAdmin(ctx);
		const installation = await slackService.installationFor(ctx.organizationId);
		if (!installation) return 0;

		const people = await db
			.select({ userId: member.userId, email: user.email })
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.leftJoin(
				memberProfile,
				and(
					eq(memberProfile.organizationId, member.organizationId),
					eq(memberProfile.userId, member.userId),
				),
			)
			.where(
				and(
					eq(member.organizationId, ctx.organizationId),
					isNull(memberProfile.archivedAt),
				),
			);

		let mapped = 0;
		for (const person of people) {
			const slackUserId = await slackClient.lookupUserByEmail(
				installation.botToken,
				person.email,
			);
			if (!slackUserId) continue;
			await db
				.insert(memberSlackIdentity)
				.values({
					organizationId: ctx.organizationId,
					userId: person.userId,
					slackUserId,
				})
				.onConflictDoUpdate({
					target: [
						memberSlackIdentity.organizationId,
						memberSlackIdentity.userId,
					],
					set: { slackUserId, updatedAt: new Date() },
				});
			mapped++;
		}
		console.info(
			`[slack] matched ${String(mapped)} of ${String(people.length)} active people by email`,
		);
		return mapped;
	},

	/** Internal: the workspace credential for an org, with the bot token opened.
	 *  Deliberately takes a raw organizationId (not a Ctx) because the reminder
	 *  job runs outside a request and iterates every org.
	 *
	 *  A token stored before encryption existed is resealed here, on its first
	 *  read. One that does not decrypt (a changed BETTER_AUTH_SECRET), or that
	 *  Slack has refused (`tokenRejectedAt`), reads as no installation, so
	 *  nothing sends with garbage and a reinstall fixes it.
	 *
	 *  `sealedBotToken` is the value as stored, for `rejectToken`. */
	installationFor: async (organizationId: string) => {
		const row = await db.query.slackInstallation.findFirst({
			where: eq(slackInstallation.organizationId, organizationId),
		});
		if (!row || row.tokenRejectedAt) return undefined;
		let sealedBotToken = row.botToken;
		const botToken = await openAndHeal(
			row.botToken,
			async (sealed) => {
				await db
					.update(slackInstallation)
					.set({ botToken: sealed })
					.where(
						and(
							eq(slackInstallation.id, row.id),
							eq(slackInstallation.botToken, row.botToken),
						),
					);
				sealedBotToken = sealed;
			},
			"a Slack bot token",
		);
		return botToken === null ? undefined : { ...row, botToken, sealedBotToken };
	},

	/** Record that Slack refused the org's bot token. Only where the row still
	 *  holds the token that was refused, so an install that replaced it in the
	 *  meantime is never marked. */
	rejectToken: async (installation: {
		id: string;
		sealedBotToken: string;
	}): Promise<void> => {
		console.error("[slack] Slack refused the bot token; install Slack again", {
			installationId: installation.id,
		});
		await db
			.update(slackInstallation)
			.set({ tokenRejectedAt: new Date() })
			.where(
				and(
					eq(slackInstallation.id, installation.id),
					eq(slackInstallation.botToken, installation.sealedBotToken),
				),
			);
	},

	slackIdFor: async (
		organizationId: string,
		userId: string,
	): Promise<string | null> => {
		const row = await db.query.memberSlackIdentity.findFirst({
			where: and(
				eq(memberSlackIdentity.organizationId, organizationId),
				eq(memberSlackIdentity.userId, userId),
			),
			columns: { slackUserId: true },
		});
		return row?.slackUserId ?? null;
	},

	/** `slackIdFor`, for a whole list in one query: user id to Slack user id,
	 *  for the people who have one. What a message needs to mention people
	 *  rather than only name them. */
	slackIdsFor: async (
		organizationId: string,
		userIds: string[],
	): Promise<Map<string, string>> => {
		if (userIds.length === 0) return new Map();
		const rows = await db
			.select({
				userId: memberSlackIdentity.userId,
				slackUserId: memberSlackIdentity.slackUserId,
			})
			.from(memberSlackIdentity)
			.where(
				and(
					eq(memberSlackIdentity.organizationId, organizationId),
					inArray(memberSlackIdentity.userId, userIds),
				),
			);
		return new Map(rows.map((r) => [r.userId, r.slackUserId]));
	},

	/** Send a DM to a person. Never throws — one person's failure must not
	 *  abort a whole reminder run. True when it went out; `"unreachable"` when
	 *  no retry can change that today (the person is not mapped, or Slack
	 *  refused them for good — see `RECIPIENT_REFUSALS`); false for anything a
	 *  later try may get through, and when the org has no Slack. A refused
	 *  token is false too, after `rejectToken` records it: the person is not
	 *  the problem, and the next read of `installationFor` finds no Slack. */
	sendDm: async (
		organizationId: string,
		userId: string,
		text: string,
	): Promise<boolean | "unreachable"> => {
		const installation = await slackService.installationFor(organizationId);
		if (!installation) return false;
		const slackUserId = await slackService.slackIdFor(organizationId, userId);
		if (!slackUserId) return "unreachable";
		const result = await slackClient.postMessage(
			installation.botToken,
			slackUserId,
			text,
		);
		if (result === "sent") return true;
		if (result === "revoked") await slackService.rejectToken(installation);
		return result === "refused" ? "unreachable" : false;
	},

	/** DM an invitation to the address it was sent to, when that address belongs
	 *  to somebody in the org's Slack workspace — beside the email, not instead
	 *  of it.
	 *
	 *  Not `sendDm` and not `notify`: both address a user, and an invitee is not
	 *  one yet. The address is the only handle, and it is the one the admin typed,
	 *  so the bot looks it up the way `linkMember` will once they have joined.
	 *  Returns whether the DM went out. Never throws: an invitation must not fail
	 *  because Slack is down, uninstalled, or the person is not in the workspace. */
	sendInvitation: async (
		organizationId: string,
		invite: {
			email: string;
			inviterName: string;
			organizationName: string;
			role: string;
			/** App-relative, query included: `/accept-invite/<id>?…`. */
			path: string;
		},
	): Promise<boolean> => {
		try {
			const installation = await slackService.installationFor(organizationId);
			if (!installation) return false;
			const slackUserId = await slackClient.lookupUserByEmail(
				installation.botToken,
				invite.email,
			);
			if (!slackUserId) return false;
			const link = slackLink(invite.path, "Accept the invitation");
			const text = `*${slackEscape(invite.inviterName)} invited you to join ${slackEscape(invite.organizationName)}* as ${slackEscape(invite.role)}.${link ? `\n${link}` : ""}`;
			const result = await slackClient.postMessage(
				installation.botToken,
				slackUserId,
				text,
			);
			if (result === "revoked") await slackService.rejectToken(installation);
			return result === "sent";
		} catch (error) {
			console.error("[slack] could not send invitation", {
				organizationId,
				error: loggableError(error),
			});
			return false;
		}
	},

	/** Who the caller may ping, for the Tracking report: the people in the
	 *  caller's scope (never the caller) who are matched to Slack, with when each
	 *  was last pinged. `year` and `month` are the org's current month, the only
	 *  month `pingBehind` judges, so the screen shows the button for that month
	 *  only. `people` is empty when the org has no working Slack install. */
	pingStates: async (
		ctx: Ctx,
		opts: { now?: Date } = {},
	): Promise<{
		year: number;
		month: number;
		people: { userId: string; pingedAt: Date | null }[];
	}> => {
		const [year, month] = dayKeyInTz(
			opts.now ?? new Date(),
			await ctxTimezone(ctx),
		)
			.split("-")
			.map(Number);
		const current = { year: year ?? 0, month: month ?? 0 };
		if (!(await slackService.installationFor(ctx.organizationId))) {
			return { ...current, people: [] };
		}
		const scope = await accessService.peopleScope(ctx, await ctxAccess(ctx));
		const rows = await db
			.select({
				userId: memberSlackIdentity.userId,
				pingedAt: slackPing.pingedAt,
			})
			.from(memberSlackIdentity)
			.leftJoin(
				slackPing,
				and(
					eq(slackPing.organizationId, memberSlackIdentity.organizationId),
					eq(slackPing.userId, memberSlackIdentity.userId),
				),
			)
			.where(eq(memberSlackIdentity.organizationId, ctx.organizationId));
		const inScope = rows.filter(
			(r) => r.userId !== ctx.userId && (scope === null || scope.has(r.userId)),
		);
		const blocked = await pingBlocked(
			ctx.organizationId,
			inScope.map((r) => r.userId),
		);
		const people = inScope.filter((r) => !blocked.has(r.userId));
		return { ...current, people };
	},

	/** DM a person who is behind their target, asking them to track their time.
	 *  The caller must see the person on the Tracking report, and the person must
	 *  be behind on it now. A second ping inside 24 hours throws
	 *  `PingTooSoonError`. A send that fails gives the ping back. */
	pingBehind: async (
		ctx: Ctx,
		userId: string,
		opts: { now?: Date } = {},
	): Promise<void> => {
		const now = opts.now ?? new Date();
		if (userId === ctx.userId) {
			throw new UserFacingError("You cannot ping yourself.");
		}
		const row = await behindRowFor(ctx, userId, now);
		const reachable =
			(await slackService.installationFor(ctx.organizationId)) &&
			(await slackService.slackIdFor(ctx.organizationId, userId));
		if (!reachable) {
			throw new UserFacingError("This person is not connected to Slack.");
		}
		if ((await pingBlocked(ctx.organizationId, [userId])).has(userId)) {
			throw new UserFacingError(CANNOT_REACH);
		}
		await claimPing(ctx, userId, now);
		// The claim stays only when the message went out, also when a step
		// before the send throws.
		let result: Awaited<ReturnType<typeof sendPing>> | undefined;
		try {
			result = await sendPing(ctx, userId);
		} finally {
			if (result !== "sent") await releasePing(ctx, userId);
		}
		if (result === "unreachable") throw new UserFacingError(CANNOT_REACH);
		if (result === "failed") {
			throw new UserFacingError("The message could not be sent. Try again.");
		}
		await recordAudit(ctx, {
			kind: "slack.pinged",
			target: { type: "member", id: userId, label: row.name },
		});
	},

	sendTest: async (ctx: Ctx, userId: string) => {
		await requireAdmin(ctx);
		// Through `notify` like every other send, so a test that passes proves the
		// same path the reminders take — including the membership check. Imported
		// here rather than at the top because `notify` imports this module for its
		// Slack adapter, and a static cycle would leave one of the two consts in
		// its temporal dead zone at call time.
		const { notify, wasDelivered } = await import("./notify");
		const sent = wasDelivered(
			await notify(
				{ organizationId: ctx.organizationId, userId },
				{
					kind: "test",
					body: "Test message from your time tracker. Reminders are wired up correctly.",
				},
			),
		);
		if (!sent) {
			throw new Error(
				"Couldn't send. Check that Slack is connected and that this person is in the workspace.",
			);
		}
	},
};
