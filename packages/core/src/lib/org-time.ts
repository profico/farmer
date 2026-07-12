import { eq } from "drizzle-orm";
import { db } from "../db";
import { organization } from "../db/schema/auth";

export const orgTimezone = async (organizationId: string): Promise<string> => {
	const org = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
	});
	return org?.timezone ?? "UTC";
};
