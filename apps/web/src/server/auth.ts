import {
	clientAddress,
	trustedIpHeader,
} from "@farmer/core/lib/client-address";
import { redirect } from "@tanstack/react-router";
import {
	createIsomorphicFn,
	createMiddleware,
	createServerFn,
} from "@tanstack/react-start";
import {
	getRequestHeaders,
	setResponseStatus,
} from "@tanstack/react-start/server";

export const getSession = createServerFn({ method: "GET" }).handler(
	async () => {
		const { auth } = await import("@farmer/core/auth");
		const session = await auth.api.getSession({
			headers: getRequestHeaders(),
		});
		return session;
	},
);

export const requireSession = async () => {
	const session = await getSession();
	if (!session) {
		throw redirect({ to: "/login" });
	}
	return session;
};

/**
 * Where the request came from, for the audit log: the client's address and
 * its User-Agent.
 *
 * Isomorphic, because `requireOrgContext` also runs in a route `beforeLoad` in
 * the browser, where there is no request to read. The Ctx built there never
 * reaches a service (a server function builds its own through the middleware
 * below), so the client half answers nothing. The address follows the same
 * rule as the rate limits (`@farmer/core/lib/client-address`, which imports nothing, so
 * it is safe in this file).
 */
type RequestOrigin = { ip: string | null; userAgent: string | null };

const requestOrigin = createIsomorphicFn()
	.server((): RequestOrigin => {
		const headers = new Headers(getRequestHeaders());
		const ip = clientAddress(
			headers,
			trustedIpHeader(process.env.TRUSTED_IP_HEADER),
		);
		return {
			ip: ip === "unknown" ? null : ip,
			userAgent: headers.get("user-agent"),
		};
	})
	.client((): RequestOrigin => ({
		ip: null,
		userAgent: null,
	}));

export const requireOrgContext = async () => {
	const session = await requireSession();
	if (!session.session.activeOrganizationId) {
		throw redirect({ to: "/" });
	}
	return {
		organizationId: session.session.activeOrganizationId,
		userId: session.user.id,
		// The door this request came through, for the audit log. Read from the
		// session row, never from the browser: an impersonated session names
		// the operator behind it.
		actor: {
			via: "web" as const,
			impersonatorId: session.session.impersonatedBy ?? null,
			...requestOrigin(),
		},
	};
};

export const getMyRole = createServerFn({ method: "GET" }).handler(async () => {
	const ctx = await requireOrgContext();
	const { membersService } = await import("@farmer/core/services");
	return membersService.getRole(ctx);
});

// The caller's §4 capability picture, flattened into something that survives
// JSON and can gate UI. Authorization itself is NOT enforced here — every
// service re-resolves `Access` server-side and asserts. This exists so the app
// can avoid rendering a nav item that would only 403, not to be trusted.
export type MyAccess = {
	isAdmin: boolean;
	canCreateProjects: boolean;
	/** projectId → the caller's role on it. Absent = unassigned. Admins get
	 *  their real assignments here, not a synthesised PM on everything. */
	projectRoles: Record<string, "member" | "team_lead" | "pm">;
	/** Any PM assignment at all. */
	isPmSomewhere: boolean;
	/** Any Team Lead or PM assignment, or a people list — gates Clients. */
	isLeadSomewhere: boolean;
	/** Has people on their Team Lead list. */
	isTeamLead: boolean;
};

export const getMyAccess = createServerFn({ method: "GET" }).handler(
	async (): Promise<MyAccess> => {
		const ctx = await requireOrgContext();
		const { accessService } = await import("@farmer/core/services");
		const access = await accessService.resolve(ctx);

		const projectRoles = Object.fromEntries(access.assignments());

		return {
			isAdmin: access.isAdmin,
			canCreateProjects: access.canCreateProjects(),
			projectRoles,
			isPmSomewhere: Object.values(projectRoles).includes("pm"),
			isLeadSomewhere:
				access.isTeamLead ||
				Object.values(projectRoles).some(
					(r) => r === "pm" || r === "team_lead",
				),
			isTeamLead: access.isTeamLead,
		};
	},
);

// Deliberately routes the role check through the `getMyRole` server fn
// instead of importing `@farmer/core/services` directly: this function is
// called straight from route `beforeLoad`s (not itself wrapped in
// `createServerFn`), which also run on the client during SPA navigation. A
// direct dynamic import here would execute in the browser and crash with
// "Buffer is not defined" (postgres.js touches Buffer at module scope).
export const requireOrgAdmin = async () => {
	const ctx = await requireOrgContext();
	const role = await getMyRole();
	if (role !== "owner" && role !== "admin") {
		throw redirect({ to: "/" });
	}
	return ctx;
};

// ── Server-function auth middleware ─────────────────────────────────────────
// Attach one of these to every `createServerFn` that touches private data via
// `.middleware([...])`, then read the resolved context from the handler's
// `context` arg instead of calling the `require*` helpers inline. This makes
// the protection part of the function's declared shape (visible in the chain,
// resolved before the validator/handler run) rather than an easy-to-forget
// first line in the handler body. These wrap the same `require*` helpers above,
// which stay exported because route `beforeLoad`s call them directly.

/**
 * Run the rest of the chain, and give an authorization refusal its status code.
 *
 * Services signal "you may not do that" by throwing `AccessError`
 * (services/access.service.ts) — every capability assertion on `Access` raises
 * one, as do the handful of checks that guard another person's data. Nothing
 * turned that into an HTTP status: it was mapped in exactly one place, the PDF
 * route, and every server function let it through as an ordinary error, so a
 * Member touching a PM-only action got a 500. A 403 is not decoration here — it
 * is the difference between "you can't" and "it broke", and the client cannot
 * tell them apart from a message.
 *
 * Deliberately re-throws rather than answering: the error's message is written
 * for the person and TanStack still carries it to the caller. This only sets the
 * status alongside it.
 *
 * `redirect(...)` throws are how the middleware below sends a non-member home,
 * and they are NOT errors — `instanceof AccessError` leaves them untouched, and
 * they carry their own response.
 *
 * The `AccessError` class is a PARAMETER, not something this function imports.
 * A top-level function body in this module ships to the browser, so a deferred
 * `import("@farmer/core/services")` in here would become a real client chunk of
 * the services barrel — the same trap documented on `requireOrgAdmin` and
 * `orgMiddleware`. The callers
 * below are `.server()` callbacks, which are stripped from the client bundle,
 * so they can import it and hand it in.
 */
const withAccessStatus = async <T>(
	AccessError: new (...args: never[]) => Error,
	run: () => Promise<T>,
): Promise<T> => {
	try {
		return await run();
	} catch (error) {
		if (error instanceof AccessError) setResponseStatus(403);
		throw error;
	}
};

// Authenticated session only (no active-org requirement).
export const sessionMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		const session = await requireSession();
		return next({ context: { session } });
	},
);

// The session, or null — for the two guards that must know WHERE the visitor
// was going before they send them to `/login`. `requireSession` redirects with
// no `redirect` param, because a server function cannot see the page that
// called it, so a shared link to a workspace page used to land on the
// workspace's home after sign-in. The caller builds that redirect itself.
export const optionalSessionMiddleware = createMiddleware({
	type: "function",
}).server(async ({ next }) => {
	const session = await getSession();
	return next({ context: { session } });
});

// Authenticated + an active organization → `context.ctx` is the service ctx.
//
// The membership check is the point, and it is not the same check as
// `requireOrgContext`'s. That one asks the session which organization is
// active; `activeOrganizationId` is written when the workspace is entered and
// is never revisited, and removing somebody from an organization does not
// invalidate their sessions — so it says where they were, not where they still
// belong. Resolving `Access` asks the database, and now throws `NotAMemberError`
// when there is no membership row (services/access.service.ts).
//
// It also has to happen here rather than only inside each service, because the
// org-wide reads are exactly the ones with nothing to assert: `clientsService.
// list` and `orgSettingsService.get` are a tenancy predicate and no more, and
// an ex-member's Ctx satisfies a tenancy predicate perfectly well.
//
// The resolved Access is memoized on the Ctx, so this costs the request
// nothing: every handler that goes on to resolve it gets this one.
//
// The `import("@farmer/core/services")` is INSIDE the `.server()` callback, and
// has to stay there. Pulled out into a shared top-level helper in this file it
// still typechecks, still runs, and breaks the client build: `.server()`
// callbacks are stripped from the browser bundle, a top-level function body is
// not, so the deferred import becomes a real client chunk of the whole services
// barrel — `postgres` touches `Buffer` at module scope and crashes hydration
// silently, and every other server-only module in it is dead weight that
// `scripts/prune-client-assets.ts` then has to delete.
export const orgMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		const ctx = await requireOrgContext();
		const { AccessError, ctxAccess, NotAMemberError } =
			await import("@farmer/core/services");
		try {
			// Also warms the memo: this Ctx object is the one the handler receives.
			await ctxAccess(ctx);
		} catch (error) {
			// "Not in this workspace" is a navigation outcome, not a failure — `/`
			// sends them to a workspace they do belong to, or to `/no-access`.
			if (error instanceof NotAMemberError) throw redirect({ to: "/" });
			throw error;
		}
		return withAccessStatus(AccessError, () => next({ context: { ctx } }));
	},
);

// Authenticated + active org + owner/admin role → `context.ctx`.
//
// Deliberately NOT `requireOrgAdmin()`, even though that helper says the same
// thing. It is written for route `beforeLoad`s, which also run in the browser,
// so it routes the role check through the `getMyRole` server function rather
// than importing services — and that costs a second full session resolution
// (`requireOrgContext` → `getSession`, then `getMyRole` → `requireOrgContext` →
// `getSession` again) plus a `member` lookup, before the handler's first
// `requireAdmin(ctx)` then resolves `Access` from cold because the ctx it was
// handed carries no memo.
//
// A `.server()` callback is stripped from the browser bundle, so none of that
// applies here: resolve `Access` once, assert on it, and hand the handler the
// very Ctx whose memo now holds it. Same shape as `orgMiddleware` above, and
// for the same reasons — see the note there about keeping the import INSIDE the
// callback.
export const orgAdminMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		const ctx = await requireOrgContext();
		const { AccessError, ctxAccess, NotAMemberError } =
			await import("@farmer/core/services");
		let access: Awaited<ReturnType<typeof ctxAccess>>;
		try {
			access = await ctxAccess(ctx);
		} catch (error) {
			if (error instanceof NotAMemberError) throw redirect({ to: "/" });
			throw error;
		}
		// Matches `requireOrgAdmin`'s behaviour: a non-admin member is sent home
		// rather than shown an error, because every caller of this middleware backs
		// a screen they should not have reached.
		if (!access.isAdmin) throw redirect({ to: "/" });
		return withAccessStatus(AccessError, () => next({ context: { ctx } }));
	},
);

/**
 * Operates the deployment → `context.session`. Not a workspace role.
 *
 * `user.role`, not `member.role` and not `Access`: a platform admin is one
 * value per person for the whole instance, and the screens behind this
 * middleware are the instance's rather than any workspace's (see
 * `packages/core/src/lib/platform-admin.ts`). Somebody who owns every
 * organization on the deployment still fails this check.
 *
 * Redirects rather than answering 403, matching `orgAdminMiddleware`: every
 * caller backs a screen that should not have been reachable, and `/` resolves
 * where the session actually belongs.
 *
 * The import stays inside the `.server()` callback for the reason written on
 * `orgMiddleware` — a top-level function body in this module ships to the
 * browser, so a deferred import here would become a real client chunk.
 */
export const platformAdminMiddleware = createMiddleware({
	type: "function",
}).server(async ({ next }) => {
	const session = await requireSession();
	const { isPlatformAdminRole } =
		await import("@farmer/core/lib/platform-admin");
	if (!isPlatformAdminRole(session.user.role)) throw redirect({ to: "/" });
	return next({ context: { session } });
});
