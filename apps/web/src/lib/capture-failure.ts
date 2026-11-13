import type { ServerFnCall } from "./posthog-api";

/**
 * Send the unexpected failure of a server function to PostHog error tracking.
 *
 * The error is always rethrown as it came, at once. TanStack hands the error
 * of `next()` back to the client, so the capture must not change it or delay
 * it: it runs after the throw and is never awaited. A failure of the capture
 * is logged and dropped. Only a fault is captured: see `isServerFnFault`. The
 * person is read from the session because the middleware runs before
 * `orgMiddleware`, so it has no `ctx`. A call that takes `SLOW_SERVER_FN_MS`
 * or more is reported in the same way, as a `server_fn_slow` event, also
 * when it throws.
 *
 * `start.ts` reaches this module with a deferred `import()` inside the
 * middleware callback, which TanStack strips from the client bundle. A static
 * import would ship `posthog-node` to the browser.
 */
export const captureFailure = async <T>(
	{
		next,
		serverFnMeta,
	}: {
		next: () => Promise<T>;
		serverFnMeta: { id: string; name: string; filename: string };
	},
	readHeaders: () => Headers,
): Promise<T> => {
	const start = performance.now();
	let error: Error | null = null;
	let threw = false;
	try {
		return await next();
	} catch (thrown) {
		threw = true;
		if (thrown instanceof Error) error = thrown;
		throw thrown;
	} finally {
		const durationMs = performance.now() - start;
		reportInBackground(
			{
				error,
				threw,
				slowMs: durationMs >= SLOW_SERVER_FN_MS ? durationMs : null,
			},
			serverFnMeta,
			readHeaders,
		);
	}
};

/** A call at or over this duration is sent as a `server_fn_slow` event. */
export const SLOW_SERVER_FN_MS = 1000;

const reportInBackground = (
	call: ServerFnCall,
	meta: { id: string; name: string; filename: string },
	readHeaders: () => Headers,
): void => {
	if (!call.error && call.slowMs === null) return;
	const fail = (captureError: Error) =>
		console.error("server function capture failed", captureError);
	try {
		// Read at once, while the request context is current.
		const headers = readHeaders();
		void import("./posthog-api")
			.then(({ reportServerFnCall }) => reportServerFnCall(headers, meta, call))
			.catch(fail);
	} catch (captureError) {
		console.error("server function capture failed", captureError);
	}
};
