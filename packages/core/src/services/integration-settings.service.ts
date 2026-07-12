import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { integrationSettings } from "../db/schema/settings";
import type { UpdateIntegrationSettingsInput } from "../schema/integration-settings";
import type { Ctx } from "./types";

export type IntegrationSettings = {
	googleAutoSyncMeetings: boolean;
	googleSyncTimeOff: boolean;
	githubAutoLoadCommits: boolean;
	githubSyncCommitsAsWorkTime: boolean;
};

const DEFAULTS: IntegrationSettings = {
	googleAutoSyncMeetings: false,
	googleSyncTimeOff: false,
	githubAutoLoadCommits: false,
	githubSyncCommitsAsWorkTime: false,
};

export const integrationSettingsService = {
	// A missing row means every toggle is off (see schema note) — connecting an
	// account never opts a user into background syncing implicitly.
	get: async (ctx: Ctx): Promise<IntegrationSettings> => {
		const row = await db.query.integrationSettings.findFirst({
			where: and(
				eq(integrationSettings.organizationId, ctx.organizationId),
				eq(integrationSettings.userId, ctx.userId),
			),
		});
		if (!row) return { ...DEFAULTS };
		return {
			googleAutoSyncMeetings: row.googleAutoSyncMeetings,
			googleSyncTimeOff: row.googleSyncTimeOff,
			githubAutoLoadCommits: row.githubAutoLoadCommits,
			githubSyncCommitsAsWorkTime: row.githubSyncCommitsAsWorkTime,
		};
	},

	// Partial patch: only the fields present in `input` change; the row is
	// created on first write. drizzle's .set()/.values() ignore `undefined`,
	// so absent toggles keep their stored (or default) value.
	update: async (
		ctx: Ctx,
		input: UpdateIntegrationSettingsInput,
	): Promise<IntegrationSettings> => {
		const [row] = await db
			.insert(integrationSettings)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				googleAutoSyncMeetings: input.googleAutoSyncMeetings ?? undefined,
				googleSyncTimeOff: input.googleSyncTimeOff ?? undefined,
				githubAutoLoadCommits: input.githubAutoLoadCommits ?? undefined,
				githubSyncCommitsAsWorkTime:
					input.githubSyncCommitsAsWorkTime ?? undefined,
			})
			.onConflictDoUpdate({
				target: [
					integrationSettings.organizationId,
					integrationSettings.userId,
				],
				set: {
					googleAutoSyncMeetings: input.googleAutoSyncMeetings,
					googleSyncTimeOff: input.googleSyncTimeOff,
					githubAutoLoadCommits: input.githubAutoLoadCommits,
					githubSyncCommitsAsWorkTime: input.githubSyncCommitsAsWorkTime,
					updatedAt: new Date(),
				},
			})
			.returning();
		if (!row) throw new Error("Failed to save integration settings");
		return {
			googleAutoSyncMeetings: row.googleAutoSyncMeetings,
			googleSyncTimeOff: row.googleSyncTimeOff,
			githubAutoLoadCommits: row.githubAutoLoadCommits,
			githubSyncCommitsAsWorkTime: row.githubSyncCommitsAsWorkTime,
		};
	},
};
