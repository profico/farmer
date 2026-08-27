import { eq } from "drizzle-orm";
import { type DbClient, db } from "../db";
import { organization } from "../db/schema/auth";

/** The org's IANA timezone.
 *
 *  Takes the client rather than reaching for the ambient handle, because the
 *  only caller (`ctxTimezone`) is reachable from INSIDE a transaction —
 *  `remove`, `copyDay` and `setWeekCell` all resolve the timezone there. An
 *  ambient read at that point needs a second pooled connection while the first
 *  is still held, which deadlocks the pool under concurrency. See
 *  `services/db-ctx.ts`. */
export const orgTimezone = async (
	organizationId: string,
	client: DbClient = db,
): Promise<string> => {
	const org = await client.query.organization.findFirst({
		where: eq(organization.id, organizationId),
	});
	return org?.timezone ?? "UTC";
};
