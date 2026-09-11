import { eq } from "drizzle-orm";

import { db } from "../db";
import { orgSettings } from "../db/schema/settings";
import { requireAdmin } from "./context";
import type { Ctx } from "./types";

export type OrgSettings = {
	/** N working days without any entry before a person is flagged (PRD §8,
	 *  default 3). The compliance report and the Slack nudge read the same N;
	 *  the reminder settings page edits it through `reminderSettingsService`. */
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

// Deliberately hardcoded and NOT settings (PRD §8): the 15-minute entry
// granularity and the close lifecycle. The reminder days, times and the
// reminders' behind-pace % are settings now — `reminderSettingsService`.
/** A person is "behind pace" below this fraction of their prorated expectation
 *  — on the Admin compliance report, and as the reminders' default. */
export const BEHIND_PACE_THRESHOLD = 0.9;

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
