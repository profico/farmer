import { eq } from "drizzle-orm";

import { type DbClient, db } from "../db";
import { organization } from "../db/schema/auth";
import {
	DEFAULT_WEEK_STARTS_ON,
	toWeekStartsOn,
	type WeekStartsOn,
} from "./time";

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

/** The day the org's weeks start on. Takes the client for the same reason as
 *  `orgTimezone`: its caller, `ctxWeekStartsOn`, can run inside a transaction. */
export const orgWeekStartsOn = async (
	organizationId: string,
	client: DbClient = db,
): Promise<WeekStartsOn> => {
	const org = await client.query.organization.findFirst({
		where: eq(organization.id, organizationId),
	});

	return org ? toWeekStartsOn(org.weekStartsOn) : DEFAULT_WEEK_STARTS_ON;
};
