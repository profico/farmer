import posthog from "posthog-js";

import { isResizeObserverLoop } from "./posthog-noise";
import { browserEnv, sendStaleChunkReports } from "./stale-chunk";

/** The credentials that the server planted for the browser. */
export type PostHogCredentials = { token: string; host: string };

/**
 * The browser's PostHog client, started before it is returned.
 *
 * `@posthog/react` starts a client in an effect of its provider. React runs
 * the effects of a child first, so a call from a child effect in the first
 * commit hit a client that was not started, and PostHog dropped it. This
 * function starts the client during the render of the provider, before any
 * child effect runs, and the provider gets it as its `client` prop. A second
 * call does nothing, because `init` of a started client does nothing.
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
			api_host: host,
			defaults: "2026-05-30",
			capture_exceptions: {
				capture_unhandled_errors: true,
				capture_unhandled_rejections: true,
				capture_console_errors: false,
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
