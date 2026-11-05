import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db";
import { importPendingPerson } from "../db/schema/import";

/** Whether a Harvest import holds history for this address that its owner may
 *  claim: the address is confirmed and the person has not declined. The
 *  registration gate reads it, so the owner can sign up while registration is
 *  closed (`assertMayRegister`). SERVER ONLY, like `single-org.ts`. */
export const hasClaimableImport = async (email: string): Promise<boolean> => {
	const [row] = await db
		.select({ userId: importPendingPerson.userId })
		.from(importPendingPerson)
		.where(
			and(
				eq(importPendingPerson.email, email.toLowerCase()),
				eq(importPendingPerson.confirmed, true),
				isNull(importPendingPerson.declinedAt),
			),
		)
		.limit(1);
	return row !== undefined;
};
