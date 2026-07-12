import { redirect } from "@tanstack/react-router";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

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

export const requireOrgContext = async () => {
	const session = await requireSession();
	if (!session.session.activeOrganizationId) {
		throw redirect({ to: "/" });
	}
	return {
		organizationId: session.session.activeOrganizationId,
		userId: session.user.id,
	};
};

export const getMyRole = createServerFn({ method: "GET" }).handler(async () => {
	const ctx = await requireOrgContext();
	const { membersService } = await import("@farmer/core/services");
	return membersService.getRole(ctx);
});

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

// Authenticated session only (no active-org requirement).
export const sessionMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		const session = await requireSession();
		return next({ context: { session } });
	},
);

// Authenticated + an active organization → `context.ctx` is the service ctx.
export const orgMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		const ctx = await requireOrgContext();
		return next({ context: { ctx } });
	},
);

// Authenticated + active org + owner/admin role → `context.ctx`.
export const orgAdminMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		const ctx = await requireOrgAdmin();
		return next({ context: { ctx } });
	},
);

// For REST routes (api/v1/*): same session-cookie auth as the UI for now,
// resolved from the request instead of ambient request headers, and
// returning null instead of throwing a router redirect on failure.
// TODO: accept a bearer API key too, once better-auth's apiKey plugin is wired up.
export const resolveApiOrgContext = async (request: Request) => {
	const { auth } = await import("@farmer/core/auth");
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session?.session.activeOrganizationId) {
		return null;
	}
	return {
		organizationId: session.session.activeOrganizationId,
		userId: session.user.id,
	};
};
