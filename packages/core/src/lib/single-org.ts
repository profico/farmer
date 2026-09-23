import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "../db";
import { invitation, member, organization } from "../db/schema/auth";
import { ensureOrgTasks } from "../db/seed-tasks";
import { setting } from "./instance-settings";

/**
 * Single-organization mode — the whole switch is one instance setting.
 *
 * Setting `SINGLE_ORG_SLUG` turns a deployment into a one-workspace instance:
 * nobody can create a second organization, signup is invitation-only, and the
 * one screen sign-in can still show — its error state — wears that
 * organization's name and logo. `/` still renders the landing page. Unset (the
 * default) is the normal multi-tenant product, unchanged.
 *
 * It is a *slug*, not a boolean, on purpose: a boolean would leave "which
 * organization?" implicit, and the only implicit answer available ("the oldest
 * row") silently picks wrong on any database that already has two.
 *
 * Read per call, not captured at import: the value can now come from the
 * Infrastructure page (`lib/instance-settings.ts`), and a process that pinned
 * it at start would disagree with the page until a restart.
 *
 * SERVER ONLY. This module touches the database, so importing it from a
 * component or from a route module's top level would both crash hydration (see
 * apps/web/CLAUDE.md) and read the mode as "off" in the browser. The client
 * learns the mode from `getPublicAppConfig` instead.
 */
export const singleOrgSlug = (): string | null =>
	setting("SINGLE_ORG_SLUG")?.trim() || null;

export const isSingleOrgMode = () => singleOrgSlug() !== null;

/**
 * The one organization, or null. Null has two distinct meanings — mode off, or
 * mode on but nobody has bootstrapped the instance yet (see `bootstrapSingleOrg`)
 * — and callers that care distinguish them with `isSingleOrgMode()`.
 */
export const findSingleOrg = async () => {
	const slug = singleOrgSlug();
	if (!slug) return null;
	return (
		(await db.query.organization.findFirst({
			where: eq(organization.slug, slug),
		})) ?? null
	);
};

/**
 * A live invitation for `email` — pending and not yet expired. Compared
 * case-insensitively: the address is typed by an admin into the invite form,
 * but matched here against whatever casing the invitee typed at signup.
 */
export const findPendingInvitation = async (
	organizationId: string,
	email: string,
) =>
	(await db.query.invitation.findFirst({
		where: and(
			eq(invitation.organizationId, organizationId),
			sql`lower(${invitation.email}) = ${email.toLowerCase()}`,
			eq(invitation.status, "pending"),
			gt(invitation.expiresAt, new Date()),
		),
	})) ?? null;

/**
 * Claim the instance for `user`, once. Returns true if this call created the
 * organization (and made the user its owner), false if someone else got there
 * first.
 *
 * The race is settled by the unique index on `organization.slug`, not by a
 * read-then-write check: two people hitting an unclaimed instance at the same
 * moment both see "no org yet", and only the insert that survives the conflict
 * hands out ownership.
 */
export const bootstrapSingleOrg = async (userId: string): Promise<boolean> => {
	const slug = singleOrgSlug();
	if (!slug) return false;
	const [created] = await db
		.insert(organization)
		.values({
			id: crypto.randomUUID(),
			// Title-cased from the slug — a placeholder the owner renames in
			// Settings → Organization, which is also where the sign-in screen's
			// branding is read from, so it's worth doing on day one.
			name: slug
				.split("-")
				.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
				.join(" "),
			slug,
			timezone: "UTC",
			country: "US",
			createdAt: new Date(),
		})
		.onConflictDoNothing({ target: organization.slug })
		.returning();
	if (!created) return false;

	await db.insert(member).values({
		id: crypto.randomUUID(),
		organizationId: created.id,
		userId,
		role: "owner",
		createdAt: new Date(),
	});
	// The starter taxonomy, same as the multi-tenant signup path. Without it the
	// instance comes up with no tasks at all, which means no entry can be logged
	// and the calendar/day-assembly engines have nothing to resolve.
	await ensureOrgTasks(created.id);
	return true;
};
