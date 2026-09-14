import { eq } from "drizzle-orm";

import { db } from "../db";
import { orgSettings } from "../db/schema/settings";
import { requireAdmin } from "./context";
import type { Ctx } from "./types";

export type OrgSettings = {
	/** The Tracking rule's tolerance (default 5): a total within this share
	 *  below the target so far is "slightly behind", not "behind". The report
	 *  and every reminder read the same number. */
	trackingTolerancePct: number;
	/** yyyy-MM-dd, or null for no lock. The automations may not write on or
	 *  before this day — see the column comment in schema/settings.ts, and
	 *  lib/automation-window, which is where it is enforced. */
	automationLockedThrough: string | null;
};

const DEFAULTS: OrgSettings = {
	trackingTolerancePct: 5,
	automationLockedThrough: null,
};

// Deliberately hardcoded and NOT a setting (PRD §8): the 15-minute entry
// granularity. The reminder days and times are `reminderSettingsService`'s.

export const orgSettingsService = {
	/** A missing row means defaults, so no backfill migration is needed. */
	get: async (ctx: Ctx): Promise<OrgSettings> => {
		const row = await db.query.orgSettings.findFirst({
			where: eq(orgSettings.organizationId, ctx.organizationId),
		});
		return {
			trackingTolerancePct:
				row?.trackingTolerancePct ?? DEFAULTS.trackingTolerancePct,
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
		if (patch.trackingTolerancePct !== undefined) {
			updateSet.trackingTolerancePct = patch.trackingTolerancePct;
		}
		if (patch.automationLockedThrough !== undefined) {
			updateSet.automationLockedThrough = patch.automationLockedThrough;
		}

		await db
			.insert(orgSettings)
			.values({
				organizationId: ctx.organizationId,
				trackingTolerancePct:
					patch.trackingTolerancePct ?? DEFAULTS.trackingTolerancePct,
				automationLockedThrough:
					patch.automationLockedThrough ?? DEFAULTS.automationLockedThrough,
			})
			.onConflictDoUpdate({
				target: orgSettings.organizationId,
				set: updateSet,
			});
	},
};
