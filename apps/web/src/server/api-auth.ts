/**
 * Authentication for the plain HTTP routes — `api/v1/*` and the PDF renderer.
 *
 * Its own module, rather than another export on `server/auth.ts`, because of
 * what imports what. `server/auth.ts` is imported by routes for its middleware
 * and by `beforeLoad`s for its `require*` helpers, which puts it in the browser
 * bundle; every top-level function body in it therefore ships to the client,
 * including the bodies of the deferred `import("@farmer/core/...")` calls, which
 * become real client chunks of the server graph. That is already why
 * `requireOrgAdmin` goes the long way round through a server function, and it is
 * a build error rather than dead weight once the graph reaches the native typst
 * binding behind `report-pdf.service`.
 *
 * Nothing in the browser can reach this file: server routes are server-only, so
 * the import below stays where it belongs.
 */

/**
 * The caller's service Ctx for a REST request, or null.
 *
 * Same session-cookie auth as the UI, resolved from the request's own headers
 * rather than the ambient ones, and returning null instead of throwing a router
 * redirect — these routes answer with a status code, not a navigation.
 *
 * TODO: accept a bearer API key too, once better-auth's apiKey plugin is wired
 * up.
 */
export const resolveApiOrgContext = async (request: Request) => {
	const { auth } = await import("@farmer/core/auth");
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session?.session.activeOrganizationId) {
		return null;
	}
	const ctx = {
		organizationId: session.session.activeOrganizationId,
		userId: session.user.id,
	};

	// The same check `orgMiddleware` makes, for the same reason: a session's
	// `activeOrganizationId` is written when the workspace is entered and never
	// revisited, so it outlives the membership that justified it. Null here
	// surfaces as the route's own 401, which is the right answer for an
	// ex-member — the credential is valid and no longer entitles them to this
	// organization.
	const { ctxAccess, NotAMemberError } = await import("@farmer/core/services");
	try {
		await ctxAccess(ctx);
	} catch (error) {
		if (error instanceof NotAMemberError) return null;
		throw error;
	}
	return ctx;
};
