import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { member, user } from "../db/schema/auth";
import { memberSlackIdentity, slackInstallation } from "../db/schema/slack";
import { signOrgState } from "../lib/oauth-state";
import {
	SLACK_BOT_SCOPES,
	slackClient,
	slackRedirectUri,
} from "../lib/slack-client";
import { accessService } from "./access.service";
import type { Ctx } from "./types";

export const slackService = {
	/** Connection status for the Settings screen. Never returns the bot token —
	 *  it is a workspace-wide credential and no client has any use for it. */
	status: async (ctx: Ctx) => {
		await accessService.requireAdmin(ctx);
		const row = await db.query.slackInstallation.findFirst({
			where: eq(slackInstallation.organizationId, ctx.organizationId),
			columns: { teamId: true, teamName: true, createdAt: true },
		});
		if (!row) return { connected: false as const };

		const identities = await db
			.select({ userId: memberSlackIdentity.userId })
			.from(memberSlackIdentity)
			.where(eq(memberSlackIdentity.organizationId, ctx.organizationId));

		return {
			connected: true as const,
			teamId: row.teamId,
			teamName: row.teamName,
			connectedAt: row.createdAt,
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
		await accessService.requireAdmin(ctx);
		const clientId = process.env.SLACK_CLIENT_ID;
		if (!clientId) throw new Error("SLACK_CLIENT_ID not configured");

		const url = new URL("https://slack.com/oauth/v2/authorize");
		url.searchParams.set("client_id", clientId);
		url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
		url.searchParams.set("redirect_uri", slackRedirectUri());
		url.searchParams.set("state", signOrgState(ctx.organizationId));
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
		await accessService.requireAdmin(ctx);

		const result = await slackClient.exchangeOAuthCode(code);
		const teamName = result.team.name ?? null;

		await db
			.insert(slackInstallation)
			.values({
				organizationId: ctx.organizationId,
				teamId: result.team.id,
				teamName,
				botToken: result.access_token,
				botUserId: result.bot_user_id,
				installedByUserId: ctx.userId,
			})
			.onConflictDoUpdate({
				target: slackInstallation.organizationId,
				set: {
					teamId: result.team.id,
					teamName,
					botToken: result.access_token,
					botUserId: result.bot_user_id,
					installedByUserId: ctx.userId,
					updatedAt: new Date(),
				},
			});

		const mapped = await slackService.syncIdentities(ctx);
		return { teamName, mapped };
	},

	disconnect: async (ctx: Ctx) => {
		await accessService.requireAdmin(ctx);
		await db
			.delete(slackInstallation)
			.where(eq(slackInstallation.organizationId, ctx.organizationId));
		await db
			.delete(memberSlackIdentity)
			.where(eq(memberSlackIdentity.organizationId, ctx.organizationId));
	},

	/** Re-resolve every member's Slack id from their email. Safe to re-run; people
	 *  who aren't in the workspace are skipped rather than failing the run. */
	syncIdentities: async (ctx: Ctx): Promise<number> => {
		const installation = await slackService.installationFor(ctx.organizationId);
		if (!installation) return 0;

		const people = await db
			.select({ userId: member.userId, email: user.email })
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(eq(member.organizationId, ctx.organizationId));

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
		return mapped;
	},

	/** Internal: the workspace credential for an org. Deliberately takes a raw
	 *  organizationId (not a Ctx) because the reminder job runs outside a request
	 *  and iterates every org. */
	installationFor: async (organizationId: string) =>
		db.query.slackInstallation.findFirst({
			where: eq(slackInstallation.organizationId, organizationId),
		}),

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

	/** Send a DM to a person. Returns false (never throws) when the org has no
	 *  Slack, the person isn't mapped, or Slack rejects the call — one person's
	 *  failure must not abort a whole reminder run. */
	sendDm: async (
		organizationId: string,
		userId: string,
		text: string,
	): Promise<boolean> => {
		const installation = await slackService.installationFor(organizationId);
		if (!installation) return false;
		const slackUserId = await slackService.slackIdFor(organizationId, userId);
		if (!slackUserId) return false;
		return slackClient.postMessage(installation.botToken, slackUserId, text);
	},

	sendTest: async (ctx: Ctx, userId: string) => {
		await accessService.requireAdmin(ctx);
		const sent = await slackService.sendDm(
			ctx.organizationId,
			userId,
			"Test message from your time tracker. Reminders are wired up correctly.",
		);
		if (!sent) {
			throw new Error(
				"Couldn't send. Check that Slack is connected and that this person is in the workspace.",
			);
		}
	},
};
