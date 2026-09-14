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
 *     The CLI's device-flow token does not change that: it is a session token,
 *     but `getSession` reads a session only from the signed cookie, and the
 *     CLI's token is read by `resolveCliUser` below and nowhere else. An MCP
 *     client that sends a CLI token here therefore gets `getMcpSession`'s
 *     answer, which is no one.
 *  2. **The organization comes from the URL.** An access token resolves to a
 *     `userId` and scopes; there is no `session.activeOrganizationId` to read,
 *     and every Ctx needs an organization. `/api/mcp/$orgSlug` is where it comes
 *     from, which matches the service layer's own rule that tenancy is an
 *     explicit parameter — and gives somebody who works in two workspaces two
 *     connector entries rather than a mode they have to remember they are in.
 *
 * Which credential was presented is the only part of that this file can answer,
 * so it is the only part that stays here. Slug plus user id to a membership-
 * checked Ctx is `orgContextService.resolveBySlug`, in `packages/core` — a
 * domain question, testable under `bun test`, shared with the CLI, and asked in
 * the same words by a future `apps/mcp` process that has no TanStack route to
 * put it in.
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

	const { orgContextService } = await import("@farmer/core/services");
	return orgContextService.resolveBySlug(userId, orgSlug);
};

/** The person behind a CLI token, and the token itself — `DELETE
 *  /api/v1/session` needs it to revoke exactly this session and no other. */
export type CliUser = {
	userId: string;
	token: string;
	user: { id: string; name: string; email: string };
};

/**
 * The person a CLI request's `Authorization: Bearer <token>` belongs to, or
 * null.
 *
 * The token is a better-auth session token: the device flow's `/device/token`
 * answers `access_token: session.token` for a session it has just created. So
 * the lookup is the session table, through better-auth's own internal adapter,
 * and NOT the `bearer` plugin — see the note on `deviceAuthorization` in
 * `packages/core/src/auth/index.ts` for why that plugin stays off.
 *
 * Null for no header, a header that is not a bearer credential, a token that
 * matches no session, and a session that has expired. The route answers all of
 * them with the same 401, which is what tells the CLI to run `farmer login`.
 *
 * **The session is refreshed here, by hand.** `getSession` slides a session's
 * expiry forward when it is used after `updateAge` (a day by default), and a
 * browser session lives on for as long as somebody keeps opening the app. It
 * does that inside the `/get-session` endpoint, though, not inside
 * `findSession` — so a session found this way never slides, and a CLI token
 * used every day would still die seven days after `farmer login`. The rule
 * below is the endpoint's own, copied rather than approximated: better-auth
 * 1.6.23, `dist/api/routes/session.mjs`, the `shouldBeUpdated` /
 * `internalAdapter.updateSession` branch of `getSession`. That branch also skips
 * the refresh under `session.disableSessionRefresh`; this app does not set it,
 * so the copy leaves it out, and must gain it if the option is ever turned on.
 */
export const resolveCliUser = async (
	request: Request,
): Promise<CliUser | null> => {
	const header = request.headers.get("authorization");
	const match = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
	const token = match?.[1];
	if (!token) return null;

	const { auth } = await import("@farmer/core/auth");
	const context = await auth.$context;
	const found = await context.internalAdapter.findSession(token);
	const now = Date.now();
	if (!found || found.session.expiresAt.getTime() <= now) return null;

	const { expiresIn, updateAge } = context.sessionConfig;
	const shouldBeUpdated =
		found.session.expiresAt.getTime() - expiresIn * 1000 + updateAge * 1000 <=
		now;
	if (shouldBeUpdated) {
		// A failed refresh is not a failed request: the session is still valid
		// for as long as it was a moment ago, and `getSession` itself only gives
		// up here when the row vanished underneath it — which the next request
		// will find out on its own.
		//
		// Caught here rather than left to the route: this runs while the request
		// is still being authenticated, outside the pipeline's error mapping, so a
		// throw would surface as the framework's own 500 instead of an answer.
		try {
			await context.internalAdapter.updateSession(token, {
				expiresAt: new Date(now + expiresIn * 1000),
				updatedAt: new Date(now),
			});
		} catch (error) {
			console.error("[api] could not refresh a CLI session", error);
		}
	}

	return {
		userId: found.user.id,
		token,
		user: {
			id: found.user.id,
			name: found.user.name,
			email: found.user.email,
		},
	};
};

/**
 * The caller's service Ctx for a CLI request, or null.
 *
 * `resolveCliUser`, then the same membership check MCP makes. The organization
 * comes from the URL for MCP's reason: a device-flow session was never used to
 * enter a workspace, so its `activeOrganizationId` says nothing. A slug nobody
 * owns, a slug the caller is not in and a bad token are one null, and so one
 * 401, on purpose — see `orgContextService.resolveBySlug`.
 */
export const resolveCliOrgContext = async (
	request: Request,
	orgSlug: string,
) => {
	const cliUser = await resolveCliUser(request);
	if (!cliUser) return null;

	const { orgContextService } = await import("@farmer/core/services");
	return orgContextService.resolveBySlug(cliUser.userId, orgSlug);
};
