import { eq } from "drizzle-orm";
import { type DbClient, db } from "../db";
import { organization } from "../db/schema/auth";

/** The org's ISO country code, used to pick a public-holiday calendar.
 *
 *  Takes a client for the same reason as `orgTimezone`: the holiday lookup is
 *  now reachable from inside a transaction (`recomputeDayFill` runs in one), and
 *  an ambient read there needs a second pooled connection while holding the
 *  first. See `services/db-ctx.ts`. */
export const orgCountry = async (
	organizationId: string,
	client: DbClient = db,
): Promise<string> => {
	const org = await client.query.organization.findFirst({
		where: eq(organization.id, organizationId),
	});
	return org?.country ?? "US";
};
