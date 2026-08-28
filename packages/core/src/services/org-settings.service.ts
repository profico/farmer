import { eq } from "drizzle-orm";

import { db } from "../db";
import { orgSettings } from "../db/schema/settings";
import { requireAdmin } from "./context";
import type { Ctx } from "./types";

export type OrgSettings = {
	/** N working days without any entry before a person is flagged (PRD §8,
	 *  default 3). The one compliance knob that IS configurable. */
	complianceMissingDays: number;
	/** yyyy-MM-dd, or null for no lock. The automations may not write on or
	 *  before this day — see the column comment in schema/settings.ts, and
	 *  lib/automation-window, which is where it is enforced. */
	automationLockedThrough: string | null;
};

const DEFAULTS: OrgSettings = {
	complianceMissingDays: 3,
	automationLockedThrough: null,
};

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
			automationLockedThrough:
				row?.automationLockedThrough ?? DEFAULTS.automationLockedThrough,
		};
	},

	update: async (ctx: Ctx, patch: Partial<OrgSettings>) => {
		await requireAdmin(ctx);
		// `undefined` means "not in this patch"; `null` is a real value here and
		// means "clear the lock", so the two cannot be collapsed.
		const updateSet: Partial<typeof orgSettings.$inferInsert> = {
			updatedAt: new Date(),
		};
		if (patch.complianceMissingDays !== undefined) {
			updateSet.complianceMissingDays = patch.complianceMissingDays;
		}
		if (patch.automationLockedThrough !== undefined) {
			updateSet.automationLockedThrough = patch.automationLockedThrough;
		}

		await db
			.insert(orgSettings)
			.values({
				organizationId: ctx.organizationId,
				complianceMissingDays:
					patch.complianceMissingDays ?? DEFAULTS.complianceMissingDays,
				automationLockedThrough:
					patch.automationLockedThrough ?? DEFAULTS.automationLockedThrough,
			})
			.onConflictDoUpdate({
				target: orgSettings.organizationId,
				set: updateSet,
			});
	},
};
