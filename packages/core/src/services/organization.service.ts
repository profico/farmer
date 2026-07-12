import { eq } from "drizzle-orm";
import { db } from "../db";
import { organization } from "../db/schema/auth";
import type { UpdateOrganizationSettingsInput } from "../schema/organization";
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

	updateSettings: async (
		ctx: Ctx,
		input: UpdateOrganizationSettingsInput,
	) => {
		const patch: Partial<{
			name: string;
			country: string;
			timezone: string;
			logo: string | null;
		}> = {};
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
		return {
			name: updated.name,
			country: updated.country,
			timezone: updated.timezone,
			logo: updated.logo,
		};
	},
};
