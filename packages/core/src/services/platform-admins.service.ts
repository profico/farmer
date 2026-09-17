import { and, asc, eq, ilike, ne, or, sql } from "drizzle-orm";

import { db } from "../db";
import * as schema from "../db/schema/auth";
import {
	isPlatformAdminRole,
	PLATFORM_ADMIN_ROLE,
} from "../lib/platform-admin";

/**
 * Who operates the deployment — the reads behind the Infrastructure page.
 *
 * **The one service with no `Ctx`, and the reason is not an oversight.** Every
 * other service takes `{ organizationId, userId }` first because its data
 * belongs to a workspace and tenancy must never be ambient. This data belongs
 * to the INSTANCE: a platform admin is one value per person for the whole
 * deployment, and the people here are not a workspace's roster. There is no
 * organization to pass, and inventing one would say something false.
 *
 * Authorization therefore cannot come from `Access`, which is a membership.
 * It comes from `user.role`, checked by `platformAdminMiddleware` at the web
 * boundary and again by better-auth's own `admin/set-role` on the write path.
 * Nothing here checks a caller, exactly like every other service — the
 * difference is only which gate stands in front of it.
 */

export type PlatformPerson = {
	id: string;
	name: string;
	email: string;
	image: string | null;
	createdAt: Date;
	isPlatformAdmin: boolean;
};

const PERSON_COLUMNS = {
	id: schema.user.id,
	name: schema.user.name,
	email: schema.user.email,
	image: schema.user.image,
	createdAt: schema.user.createdAt,
	role: schema.user.role,
} as const;

const toPerson = (row: {
	id: string;
	name: string;
	email: string;
	image: string | null;
	createdAt: Date;
	role: string | null;
}): PlatformPerson => ({
	id: row.id,
	name: row.name,
	email: row.email,
	image: row.image,
	createdAt: row.createdAt,
	isPlatformAdmin: isPlatformAdminRole(row.role),
});

/** How many people a search will show at once. A search box is for finding one
 *  person you can already name, not for reading the instance's user table. */
export const PLATFORM_SEARCH_LIMIT = 10;

/** The shortest query that is answered. One letter matches most of a
 *  deployment, which is the listing this page deliberately does not do. */
export const PLATFORM_SEARCH_MIN_LENGTH = 2;

/**
 * Everybody who holds the role, oldest first.
 *
 * Oldest first rather than alphabetically because the first row is a fact about
 * the instance — it is the account that bootstrapped it (`claimPlatformAdmin`
 * in `auth/index.ts`), and seeing it at the top is how somebody recognises the
 * deployment they are looking at.
 */
export const listPlatformAdmins = async (): Promise<PlatformPerson[]> => {
	const rows = await db
		.select(PERSON_COLUMNS)
		.from(schema.user)
		.where(eq(schema.user.role, PLATFORM_ADMIN_ROLE))
		.orderBy(asc(schema.user.createdAt), asc(schema.user.id));
	return rows.map(toPerson);
};

/**
 * Find somebody to promote, by name or address.
 *
 * **A search, deliberately not a list.** The page shows who holds the role and
 * nothing else until you ask for a specific person: on a multi-tenant instance
 * the user table is every customer's staff directory, and rendering it into an
 * admin screen turns "grant somebody the role" into "read everybody's name and
 * email address". A query too short to be a search returns nothing rather than
 * everybody.
 *
 * Case- and accent-insensitivity is `ilike`'s, not `lib/search.ts`'s: that one
 * filters rows already in the browser, and this must not put them there.
 */
export const searchPlatformPeople = async (
	query: string,
): Promise<PlatformPerson[]> => {
	const term = query.trim();
	if (term.length < PLATFORM_SEARCH_MIN_LENGTH) return [];
	// `%` and `_` are wildcards to `ilike`, so a pasted address with an
	// underscore would otherwise match more than itself.
	const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
	const rows = await db
		.select(PERSON_COLUMNS)
		.from(schema.user)
		.where(
			and(
				or(ilike(schema.user.name, pattern), ilike(schema.user.email, pattern)),
				// The people who already hold it are on the page above this list.
				// A result that is already an admin reads as a second row for the
				// same person, with a button that would do nothing.
				or(
					ne(schema.user.role, PLATFORM_ADMIN_ROLE),
					sql`${schema.user.role} is null`,
				),
			),
		)
		.orderBy(asc(schema.user.name), asc(schema.user.id))
		.limit(PLATFORM_SEARCH_LIMIT);
	return rows.map(toPerson);
};

/** How many people hold the role. The demotion guard reads this. */
export const countPlatformAdmins = async (): Promise<number> => {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(schema.user)
		.where(eq(schema.user.role, PLATFORM_ADMIN_ROLE));
	return row?.count ?? 0;
};

/** One person, or null. Used to answer "is this id real, and what is it now". */
export const findPlatformPerson = async (
	userId: string,
): Promise<PlatformPerson | null> => {
	const [row] = await db
		.select(PERSON_COLUMNS)
		.from(schema.user)
		.where(eq(schema.user.id, userId))
		.limit(1);
	return row ? toPerson(row) : null;
};

export const platformAdminsService = {
	list: listPlatformAdmins,
	search: searchPlatformPeople,
	count: countPlatformAdmins,
	find: findPlatformPerson,
	SEARCH_LIMIT: PLATFORM_SEARCH_LIMIT,
	SEARCH_MIN_LENGTH: PLATFORM_SEARCH_MIN_LENGTH,
};
