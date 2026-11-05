import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db";
import { member } from "../db/schema/auth";
import { importPendingPerson } from "../db/schema/import";

/** Whether a Harvest import holds history for this address that its owner may
 *  claim: the address is confirmed, the person has not declined and the
 *  placeholder is still a member (an admin may have removed it). The
 *  registration gate reads it, so the owner can sign up while registration is
 *  closed (`assertMayRegister`). SERVER ONLY, like `single-org.ts`. */
export const hasClaimableImport = async (email: string): Promise<boolean> => {
	const [row] = await db
		.select({ userId: importPendingPerson.userId })
		.from(importPendingPerson)
		.innerJoin(
			member,
			and(
				eq(member.organizationId, importPendingPerson.organizationId),
				eq(member.userId, importPendingPerson.userId),
			),
		)
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
