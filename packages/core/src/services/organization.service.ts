import { eq } from "drizzle-orm";

import { db } from "../db";
import { organization } from "../db/schema/auth";
import { toWeekStartsOn } from "../lib/time";
import {
	isIanaTimezone,
	type UpdateOrganizationSettingsInput,
} from "../schema/organization";
import { diffFields, recordAudit } from "./audit";
import { invalidateCtxOrgCalendar, requireAdmin } from "./context";
import type { Ctx } from "./types";
import { assertOwnUpload } from "./uploads.service";

export const organizationService = {
	// Admin only, for the reason written on `updateSettings`. A member reads
	// the timezone and the week start from `ctxTimezone` and `whoami`.
	getSettings: async (ctx: Ctx) => {
		await requireAdmin(ctx);
		const org = await db.query.organization.findFirst({
			where: eq(organization.id, ctx.organizationId),
		});
		if (!org) throw new Error("Organization not found");
		return {
			name: org.name,
			country: org.country,
			timezone: org.timezone,
			weekStartsOn: toWeekStartsOn(org.weekStartsOn),
			logo: org.logo,
		};
	},

	updateSettings: async (ctx: Ctx, input: UpdateOrganizationSettingsInput) => {
		// Asserted here and not only by `orgAdminMiddleware`: every service
		// re-resolves Access itself, so a caller that is not a server function
		// (a job, an assistant tool, a future REST route) cannot rename the org.
		await requireAdmin(ctx);
		const patch: Partial<typeof organization.$inferInsert> = {};
		if (input.name !== undefined) patch.name = input.name;
		if (input.country !== undefined) patch.country = input.country;
		if (input.timezone !== undefined) {
			// Validate against the IANA database rather than trusting the client —
			// an invalid zone here would silently corrupt every downstream time
			// calculation (see lib/time.ts).
			if (!isIanaTimezone(input.timezone)) {
				throw new Error("Invalid timezone");
			}
			patch.timezone = input.timezone;
		}
		if (input.weekStartsOn !== undefined) {
			patch.weekStartsOn = input.weekStartsOn;
		}
		// An empty string clears the logo; a URL or an uploaded image sets it.
		if (input.logo !== undefined) {
			assertOwnUpload(ctx, input.logo);
			patch.logo = input.logo || null;
		}
		const before = await db.query.organization.findFirst({
			where: eq(organization.id, ctx.organizationId),
		});
		const [updated] = await db
			.update(organization)
			.set(patch)
			.where(eq(organization.id, ctx.organizationId))
			.returning();
		if (!updated) throw new Error("Organization not found");
		// The Ctx memoizes the org timezone and week start; a stale one would keep
		// computing day keys and weeks the old way for the rest of this request.
		if (input.timezone !== undefined || input.weekStartsOn !== undefined) {
			invalidateCtxOrgCalendar(ctx);
		}
		const changes = diffFields(before, updated, [
			"name",
			"country",
			"timezone",
			"weekStartsOn",
			"logo",
		]);
		if (changes) {
			await recordAudit(ctx, {
				kind: "organization.updated",
				target: { type: "organization", id: updated.id, label: updated.name },
				changes,
			});
		}
		return {
			name: updated.name,
			country: updated.country,
			timezone: updated.timezone,
			weekStartsOn: toWeekStartsOn(updated.weekStartsOn),
			logo: updated.logo,
		};
	},
};
