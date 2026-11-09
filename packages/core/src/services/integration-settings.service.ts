import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { integrationSettings } from "../db/schema/settings";
import type { UpdateIntegrationSettingsInput } from "../schema/integration-settings";
import { ctxAccess } from "./context";
import { assertProjectActive } from "./filing-rules.service";
import { assertProjectInOrg } from "./guards";
import type { Ctx } from "./types";

export type IntegrationSettings = {
	googleAutoSyncMeetings: boolean;
	/** The project for a synced meeting that no filing rule matches. */
	googleMeetingFallbackProjectId: string | null;
	githubAutoLoadCommits: boolean;
	githubSyncCommitsAsWorkTime: boolean;
	/** When each write-capable automation was switched on — the day it may write
	 *  from. See the schema note; `githubAutoLoadCommits` has no counterpart
	 *  because it writes nothing, it only pre-loads suggestions into a dialog. */
	googleAutoSyncMeetingsSince: Date | null;
	githubSyncCommitsAsWorkTimeSince: Date | null;
};

const DEFAULTS: IntegrationSettings = {
	googleAutoSyncMeetings: false,
	googleMeetingFallbackProjectId: null,
	githubAutoLoadCommits: false,
	githubSyncCommitsAsWorkTime: false,
	googleAutoSyncMeetingsSince: null,
	githubSyncCommitsAsWorkTimeSince: null,
};

const fromRow = (
	row: typeof integrationSettings.$inferSelect,
): IntegrationSettings => ({
	googleAutoSyncMeetings: row.googleAutoSyncMeetings,
	googleMeetingFallbackProjectId: row.googleMeetingFallbackProjectId,
	githubAutoLoadCommits: row.githubAutoLoadCommits,
	githubSyncCommitsAsWorkTime: row.githubSyncCommitsAsWorkTime,
	googleAutoSyncMeetingsSince: row.googleAutoSyncMeetingsSince,
	githubSyncCommitsAsWorkTimeSince: row.githubSyncCommitsAsWorkTimeSince,
});

/** A fallback project must be one that the sync can use: active, in the org,
 *  and open to the person. The sync checks it again at each pass. */
const assertFallbackProject = async (ctx: Ctx, projectId: string) => {
	await assertProjectInOrg(ctx, projectId);
	await assertProjectActive(ctx, projectId);
	(await ctxAccess(ctx)).assertCanTrackOn(projectId);
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
		return fromRow(row);
	},

	// Partial patch: only the fields present in `input` change; the row is
	// created on first write. drizzle's .set()/.values() ignore `undefined`,
	// so absent toggles keep their stored (or default) value.
	//
	// Read-then-write rather than a SQL `case` over `excluded`, because the "when
	// did this switch go on" stamp is a transition and the patch is partial: the
	// new value alone cannot say whether anything changed. Per-user settings, so
	// there is no contention worth the SQL gymnastics.
	update: async (
		ctx: Ctx,
		input: UpdateIntegrationSettingsInput,
	): Promise<IntegrationSettings> => {
		if (input.googleMeetingFallbackProjectId) {
			await assertFallbackProject(ctx, input.googleMeetingFallbackProjectId);
		}
		const current = await integrationSettingsService.get(ctx);
		const now = new Date();

		/** The stamp after this patch: set when a switch goes off->on, cleared when
		 *  it goes on->off, untouched otherwise. Switching off and back on moves
		 *  the floor forward rather than reopening everything since the first time,
		 *  which is what someone toggling it means. */
		const sinceAfter = (
			next: boolean | undefined,
			was: boolean,
		): Date | null | undefined => {
			if (next === undefined || next === was) return undefined;
			return next ? now : null;
		};

		const googleSince = sinceAfter(
			input.googleAutoSyncMeetings,
			current.googleAutoSyncMeetings,
		);
		const commitsSince = sinceAfter(
			input.githubSyncCommitsAsWorkTime,
			current.githubSyncCommitsAsWorkTime,
		);

		const [row] = await db
			.insert(integrationSettings)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				googleAutoSyncMeetings: input.googleAutoSyncMeetings ?? undefined,
				googleMeetingFallbackProjectId: input.googleMeetingFallbackProjectId,
				githubAutoLoadCommits: input.githubAutoLoadCommits ?? undefined,
				githubSyncCommitsAsWorkTime:
					input.githubSyncCommitsAsWorkTime ?? undefined,
				googleAutoSyncMeetingsSince: googleSince ?? undefined,
				githubSyncCommitsAsWorkTimeSince: commitsSince ?? undefined,
			})
			.onConflictDoUpdate({
				target: [
					integrationSettings.organizationId,
					integrationSettings.userId,
				],
				set: {
					googleAutoSyncMeetings: input.googleAutoSyncMeetings,
					googleMeetingFallbackProjectId: input.googleMeetingFallbackProjectId,
					githubAutoLoadCommits: input.githubAutoLoadCommits,
					githubSyncCommitsAsWorkTime: input.githubSyncCommitsAsWorkTime,
					googleAutoSyncMeetingsSince: googleSince,
					githubSyncCommitsAsWorkTimeSince: commitsSince,
					updatedAt: now,
				},
			})
			.returning();
		if (!row) throw new Error("Failed to save integration settings");
		return fromRow(row);
	},
};
