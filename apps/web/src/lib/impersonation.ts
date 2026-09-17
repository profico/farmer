import { authClient } from "#/lib/auth-client.ts";
import { getDefaultOrgSlugForSession } from "#/server/organization.ts";

/**
 * Starting and stopping impersonation, and the one rule both share.
 *
 * **Both end in a full document load, never a router invalidation.** Either
 * call replaces the session cookie with a different person's, and almost
 * nothing in the app re-reads the session after the shell has mounted: the
 * organization, the caller's role, the assistant's availability and the
 * `myAccess` gate are all resolved once in `/$orgSlug`'s `beforeLoad` and held
 * in the router context, and the whole query cache is keyed by org slug rather
 * than by person. Invalidating the router would leave the new session reading
 * the previous person's cached answers — a timesheet that is not theirs, drawn
 * under their name. A document load throws all of it away, which is the only
 * honest thing to do when the identity underneath changes.
 *
 * Who may call `start` is decided on the server, by better-auth's admin plugin
 * against `user.role` (see `packages/core/src/lib/platform-admin.ts`). The
 * `isPlatformAdmin` flag the screens gate on only keeps a button off a page
 * where it would 403.
 */

/**
 * Send the browser to the workspace the session now belongs to.
 *
 * Deliberately NOT the org slug in the current URL — the person you have just
 * become need not be a member of it, and after Stop you need not be either.
 * Asked after the cookie swap, `getDefaultOrgSlugForSession` answers for the
 * new session: its active organization while the membership behind it still
 * holds, else the oldest one that does.
 *
 * `/` is the fallback and not the destination. It is the landing PAGE, which
 * renders for signed-out visitors and only offers a link onward — so arriving
 * there after pressing Impersonate reads as having been logged out. It is
 * still the right answer when the resolve fails or the person is in no
 * workspace at all, because `/`'s own CTA then routes them to `/no-access`,
 * which explains it.
 */
const leaveFor = async () => {
	const slug = await getDefaultOrgSlugForSession().catch(() => null);
	window.location.assign(slug ? `/${slug}` : "/");
};

export const startImpersonating = async (userId: string) => {
	const { error } = await authClient.admin.impersonateUser({ userId });

	if (error) throw new Error(error.message ?? "Could not impersonate");
	await leaveFor();
};

export const stopImpersonating = async () => {
	const { error } = await authClient.admin.stopImpersonating();

	if (error) throw new Error(error.message ?? "Could not stop impersonating");
	await leaveFor();
};
