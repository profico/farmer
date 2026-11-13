import {
	createCsrfMiddleware,
	createMiddleware,
	createStart,
} from "@tanstack/react-start";

import { reportServerFnNetworkError } from "./lib/posthog-client";

/**
 * Bring the instance's settings up to date before any handler reads one.
 *
 * The settings are read synchronously (`setting()` in
 * `@farmer/core/lib/instance-settings`), from a snapshot of the
 * `instance_setting` table. This is the one place every request passes —
 * pages, server functions and server routes such as `/api/files` — so it is
 * where the snapshot is refreshed. The refresh is cached for a few seconds and
 * shared by concurrent requests, so it is one small query at most.
 *
 * The import is inside the handler for the reason in `apps/web/CLAUDE.md`: a
 * top-level import of the server graph breaks hydration.
 */
const instanceSettingsMiddleware = createMiddleware().server(
	async ({ next }) => {
		const { refreshInstanceSettings } = await import("@farmer/core/services");
		await refreshInstanceSettings();
		return next();
	},
);

/**
 * This deployment's own origin, from `BETTER_AUTH_URL` — the value the CSRF
 * check below trusts. Not read from the request: a request's own `url` is
 * built from the `Host` header a reverse proxy sets, and a misconfigured or
 * hostile proxy is exactly the thing the check should not take its own
 * answer key from.
 */
const configuredOrigin = (): string | null =>
	URL.parse(process.env.BETTER_AUTH_URL ?? "")?.origin ?? null;

/**
 * Refuse a cross-site call to a server function.
 *
 * A server function is a same-origin RPC endpoint that acts with the caller's
 * session cookie, so a page on another site could otherwise make a signed-in
 * browser call one. The check reads `Sec-Fetch-Site` first (unchanged, the
 * library's default of `same-origin`), then `Origin`, then `Referer`. Server
 * routes (`/api/*`) are not in the filter: the OAuth callbacks, the webhooks,
 * the MCP server and the CLI's API are called from other origins on purpose
 * and carry their own authentication.
 *
 * `Origin`/`Referer` are matched against `BETTER_AUTH_URL`, the app's own
 * trusted origin, rather than the library's default of the inbound request's
 * own origin — see `configuredOrigin`. `vite dev` is the one place this would
 * otherwise misfire: `BETTER_AUTH_URL` is commonly `http://localhost:3000`
 * while the dev server falls back to 3001+ when 3000 is busy, so outside
 * production the inbound origin is accepted too, and when `BETTER_AUTH_URL`
 * is unset entirely this falls back to the library's own same-origin check.
 */
const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
	origin: (value, ctx) => {
		const trusted = configuredOrigin();
		if (!trusted) return value === new URL(ctx.request.url).origin;
		if (value === trusted) return true;
		return (
			process.env.NODE_ENV !== "production" &&
			value === new URL(ctx.request.url).origin
		);
	},
});

// Same signature as `captureFailure`, so both branches infer one result type.
const passThrough = <T>({ next }: { next: () => Promise<T> }) => next();

// Both server-only imports stay inside this callback: TanStack strips it from
// the client bundle, and a top-level import is not stripped.
const captureFailureMiddleware = createMiddleware({ type: "function" })
	.client(async ({ next, serverFnMeta }) => {
		try {
			return await next();
		} catch (error) {
			if (error instanceof TypeError) {
				reportServerFnNetworkError(error, serverFnMeta.id);
			}
			throw error;
		}
	})
	.server(async (args) => {
		// A failed import must not fail the call: the call then runs uncaptured.
		const modules = await Promise.all([
			import("@tanstack/react-start/server"),
			import("./lib/capture-failure"),
		]).catch((error: unknown) => {
			console.error("Failure capture is off for this call", error);
			return null;
		});
		if (!modules) return passThrough(args);
		const [{ getRequestHeaders }, { captureFailure }] = modules;
		return captureFailure(args, getRequestHeaders);
	});

export const startInstance = createStart(() => ({
	requestMiddleware: [csrfMiddleware, instanceSettingsMiddleware],
	functionMiddleware: [captureFailureMiddleware],
}));
