import posthog from "posthog-js";

import { isResizeObserverLoop } from "./posthog-noise";
import { POSTHOG_PROXY_PATH, posthogCloudRegion } from "./posthog-proxy-path";
import { browserEnv, sendStaleChunkReports } from "./stale-chunk";

/** The credentials that the server planted for the browser. */
export type PostHogCredentials = { token: string; host: string };

/** The PostHog app host that the toolbar links to. Without it, posthog-js
 *  takes `api_host`, which is now the app's own proxy path. */
const uiHost = (host: string): string | undefined => {
	const region = posthogCloudRegion(host);
	if (region) return `https://${region}.posthog.com`;
	// A host typed without a scheme must not stop the app in the browser.
	return URL.parse(host)?.origin;
};

/**
 * The browser's PostHog client, started before it is returned.
 *
 * `@posthog/react` starts a client in an effect of its provider. React runs
 * the effects of a child first, so a call from a child effect in the first
 * commit hit a client that was not started, and PostHog dropped it. This
 * function starts the client during the render of the provider, before any
 * child effect runs, and the provider gets it as its `client` prop. A second
 * call does nothing, because the `__loaded` guard skips `init`.
 *
 * On the server it returns the client without a start, because the server
 * sends no event from it and has no `window`.
 */
export function startPostHog({
	token,
	host,
}: PostHogCredentials): typeof posthog {
	if (import.meta.env.SSR) return posthog;
	if (!posthog.__loaded) {
		posthog.init(token, {
			api_host: `${window.location.origin}${POSTHOG_PROXY_PATH}`,
			ui_host: uiHost(host),
			defaults: "2026-05-30",
			capture_exceptions: {
				capture_unhandled_errors: true,
				capture_unhandled_rejections: true,
				capture_console_errors: false,
			},
			// A client value wins over the project's remote setting, so vitals are
			// on here for every project. The default attribution (INP and LCP) names
			// the element behind a slow metric. CLS stays out, because its
			// attribution keeps detached DOM nodes and can leak memory in an SPA.
			// Soft navigations make each router change its own measurement
			// (Chrome only; other browsers measure the page load).
			capture_performance: {
				web_vitals: true,
				__preview_web_vitals_soft_navs: true,
			},
			before_send: (event) =>
				event && isResizeObserverLoop(event) ? null : event,
			debug: import.meta.env.DEV,
			tracing_headers: [window.location.hostname],
		});
		// The tab reloaded because a deploy removed a chunk (`stale-chunk.ts`).
		// The old page cannot be sure to send an event before it unloads, so this
		// page sends it, one time.
		sendStaleChunkReports(posthog, browserEnv().storage);
	}
	return posthog;
}

/**
 * Report a server function call that never got an answer.
 *
 * `fetch` rejects with a `TypeError` when the network fails (Firefox:
 * "NetworkError when attempting to fetch resource", Chrome: "Failed to
 * fetch"). The error has no URL, so the event names the function. It is a plain event, not an
 * exception, because the same rejection can reach the unhandled-rejection
 * capture too. The caller rethrows the error.
 */
export function reportServerFnNetworkError(
	error: TypeError,
	serverFnName: string,
): void {
	if (!posthog.__loaded) return;
	posthog.capture("server_fn_network_error", {
		server_fn_name: serverFnName,
		message: error.message,
		online: navigator.onLine,
	});
}
