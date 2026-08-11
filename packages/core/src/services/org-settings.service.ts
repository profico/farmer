import { eq } from "drizzle-orm";
import { db } from "../db";
import { orgSettings } from "../db/schema/settings";
import { accessService } from "./access.service";
import type { Ctx } from "./types";

export type OrgSettings = {
	/** N working days without any entry before a person is flagged (PRD §8,
	 *  default 3). The one compliance knob that IS configurable. */
	complianceMissingDays: number;
};

const DEFAULTS: OrgSettings = { complianceMissingDays: 3 };

// Deliberately hardcoded and NOT settings (PRD §8): the behind-pace threshold,
// the reminder days, the 15-minute entry granularity and the close lifecycle.
/** A person is "behind pace" below this fraction of their prorated expectation. */
export const BEHIND_PACE_THRESHOLD = 0.9;
/** Reminder days, 0=Sun..6=Sat — Tuesday and Friday, max 2 nudges per week. */
export const REMINDER_WEEKDAYS = [2, 5] as const;

export const orgSettingsService = {
	/** A missing row means defaults, so no backfill migration is needed. */
	get: async (ctx: Ctx): Promise<OrgSettings> => {
		const row = await db.query.orgSettings.findFirst({
			where: eq(orgSettings.organizationId, ctx.organizationId),
		});
		return {
			complianceMissingDays:
				row?.complianceMissingDays ?? DEFAULTS.complianceMissingDays,
		};
	},

	update: async (ctx: Ctx, patch: Partial<OrgSettings>) => {
		await accessService.requireAdmin(ctx);
		await db
			.insert(orgSettings)
			.values({
				organizationId: ctx.organizationId,
				complianceMissingDays:
					patch.complianceMissingDays ?? DEFAULTS.complianceMissingDays,
			})
			.onConflictDoUpdate({
				target: orgSettings.organizationId,
				set: {
					...(patch.complianceMissingDays !== undefined
						? { complianceMissingDays: patch.complianceMissingDays }
						: {}),
					updatedAt: new Date(),
				},
			});
	},
};
