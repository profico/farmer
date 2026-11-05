import { type SQL, eq, sql } from "drizzle-orm";

import type { db } from "../db";
import { member, user } from "../db/schema/auth";
import { memberProfile } from "../db/schema/people";

// What an organization may show of a person whose claim is pending
// (`memberProfile.claimPendingSince`). `user` holds the people of every
// organization, so the global name and image of an existing account must not
// reach an org that only guessed the address (issue #158). Use these in place
// of `user.name` and `user.image` in each read that the org sees.
// The claim name also covers a person who declined: the profile stays but
// the member row is gone, and the org's history must not show the real name.
const pendingClaim = (orgId: string) =>
	sql`from ${memberProfile} where ${memberProfile.organizationId} = ${orgId} and ${memberProfile.userId} = ${user.id} and (${memberProfile.claimPendingSince} is not null or (${memberProfile.claimName} is not null and not exists (select 1 from ${member} where ${member.organizationId} = ${orgId} and ${member.userId} = ${user.id})))`;

export const shownName = (orgId: string): SQL<string> =>
	sql<string>`coalesce((select ${memberProfile.claimName} ${pendingClaim(orgId)}), ${user.name})`;

export const shownImage = (orgId: string): SQL<string | null> =>
	sql<
		string | null
	>`case when exists (select 1 ${pendingClaim(orgId)}) then null else ${user.image} end`;

/** The name an audit label or an event payload may carry for `userId`. */
export const shownNameOf = async (
	client: Pick<typeof db, "select">,
	orgId: string,
	userId: string,
): Promise<string | null> => {
	const [row] = await client
		.select({ name: shownName(orgId) })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return row?.name ?? null;
};
