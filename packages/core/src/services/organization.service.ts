import { eq } from "drizzle-orm";

import { db } from "../db";
import { organization } from "../db/schema/auth";
import type { UpdateOrganizationSettingsInput } from "../schema/organization";
import { invalidateCtxTimezone, requireAdmin } from "./context";
import type { Ctx } from "./types";

export const organizationService = {
	getSettings: async (ctx: Ctx) => {
		const org = await db.query.organization.findFirst({
			where: eq(organization.id, ctx.organizationId),
		});
		if (!org) throw new Error("Organization not found");
		return {
			name: org.name,
			country: org.country,
			timezone: org.timezone,
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
			let isValidTimezone = false;
			try {
				new Intl.DateTimeFormat(undefined, { timeZone: input.timezone });
				isValidTimezone = true;
			} catch {
				isValidTimezone = false;
			}
			if (!isValidTimezone) {
				throw new Error("Invalid timezone");
			}
			patch.timezone = input.timezone;
		}
		// An empty string clears the logo; a URL sets it.
		if (input.logo !== undefined) patch.logo = input.logo || null;
		const [updated] = await db
			.update(organization)
			.set(patch)
			.where(eq(organization.id, ctx.organizationId))
			.returning();
		if (!updated) throw new Error("Organization not found");
		// The Ctx memoizes the org timezone; a stale one would keep computing
		// day keys in the old zone for the rest of this request.
		if (input.timezone !== undefined) invalidateCtxTimezone(ctx);
		return {
			name: updated.name,
			country: updated.country,
			timezone: updated.timezone,
			logo: updated.logo,
		};
	},
};
