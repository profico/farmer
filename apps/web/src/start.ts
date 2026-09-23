import {
	createCsrfMiddleware,
	createMiddleware,
	createStart,
} from "@tanstack/react-start";

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
 * Refuse a cross-site call to a server function.
 *
 * A server function is a same-origin RPC endpoint that acts with the caller's
 * session cookie, so a page on another site could otherwise make a signed-in
 * browser call one. The check reads `Sec-Fetch-Site`, then `Origin`, then
 * `Referer`. Server routes (`/api/*`) are not in the filter: the OAuth
 * callbacks, the webhooks, the MCP server and the CLI's API are called from
 * other origins on purpose and carry their own authentication.
 */
const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
	requestMiddleware: [csrfMiddleware, instanceSettingsMiddleware],
}));
