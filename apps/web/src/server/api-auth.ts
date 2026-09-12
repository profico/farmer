/**
 * Authentication for the plain HTTP routes — `api/v1/*`, the PDF renderer, the
 * assistant's stream and the MCP server.
 *
 * Its own module, rather than another export on `server/auth.ts`, because of
 * what imports what. `server/auth.ts` is imported by routes for its middleware
 * and by `beforeLoad`s for its `require*` helpers, which puts it in the browser
 * bundle; every top-level function body in it therefore ships to the client,
 * including the bodies of the deferred `import("@farmer/core/...")` calls, which
 * become real client chunks of the server graph. That is already why
 * `requireOrgAdmin` goes the long way round through a server function: the
 * graph reaches `postgres`, which touches `Buffer` at module scope and crashes
 * hydration silently.
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
 * Session cookie only. A bearer credential reaches this app through
 * `resolveMcpOrgContext` below, which is a different question in two ways —
 * see the note there — and `api/v1` deliberately stays cookie-authed until it
 * has API keys of its own.
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

/**
 * The caller's service Ctx for an MCP request, or null.
 *
 * Two things make this a different question from `resolveApiOrgContext`, not a
 * parameterization of it:
 *
 *  1. **The credential may be a bearer token.** An MCP client holds one of the
 *     authorization server's own access tokens, not a session cookie. Both are
 *     accepted — a browser hitting the same URL while signed in is a useful
 *     thing during development — and the cookie is tried first, because no
 *     `apiKey` or `bearer` plugin is enabled here, so an `Authorization` header
 *     is inert for `getSession` and needs no special handling. If either plugin
 *     is ever added, this ordering stops being free and has to be revisited.
 *  2. **The organization comes from the URL.** An access token resolves to a
 *     `userId` and scopes; there is no `session.activeOrganizationId` to read,
 *     and every Ctx needs an organization. `/api/mcp/$orgSlug` is where it comes
 *     from, which matches the service layer's own rule that tenancy is an
 *     explicit parameter — and gives somebody who works in two workspaces two
 *     connector entries rather than a mode they have to remember they are in.
 *
 * Which credential was presented is the only part of that this file can answer,
 * so it is the only part that stays here. Slug plus user id to a membership-
 * checked Ctx is `mcpService.resolveOrgContext`, in `packages/core` — a domain
 * question, testable under `bun test`, and asked in the same words by a future
 * `apps/mcp` process that has no TanStack route to put it in.
 */
export const resolveMcpOrgContext = async (
	request: Request,
	orgSlug: string,
) => {
	const { auth } = await import("@farmer/core/auth");

	const session = await auth.api.getSession({ headers: request.headers });
	const userId =
		session?.user.id ??
		(await auth.api.getMcpSession({ headers: request.headers }))?.userId;
	if (!userId) return null;

	const { mcpService } = await import("@farmer/core/services");
	return mcpService.resolveOrgContext(userId, orgSlug);
};
