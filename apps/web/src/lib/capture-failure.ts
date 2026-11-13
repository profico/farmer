/**
 * Send the unexpected failure of a server function to PostHog error tracking.
 *
 * The error is always rethrown as it came, at once. TanStack hands the error
 * of `next()` back to the client, so the capture must not change it or delay
 * it: it runs after the throw and is never awaited. A failure of the capture
 * is logged and dropped. Only a fault is captured: see `isServerFnFault`. The
 * person is read from the session because the middleware runs before
 * `orgMiddleware`, so it has no `ctx`. A call that takes `SLOW_SERVER_FN_MS`
 * or more is reported the same way, as a `server_fn_slow` event.
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
		serverFnMeta: { name: string; filename: string };
	},
	readHeaders: () => Headers,
	now: () => number = () => performance.now(),
): Promise<T> => {
	const start = now();
	try {
		const result = await next();
		reportIfSlow(now() - start, false, serverFnMeta, readHeaders);
		return result;
	} catch (error) {
		reportIfSlow(now() - start, true, serverFnMeta, readHeaders);
		if (error instanceof Error) {
			reportInBackground(error, serverFnMeta, readHeaders);
		}
		throw error;
	}
};

/** A call at or over this duration is sent as a `server_fn_slow` event. */
export const SLOW_SERVER_FN_MS = 1000;

type FnMeta = { name: string; filename: string };

const logCaptureFailure = (captureError: Error) =>
	console.error("server function capture failed", captureError);

/** Run a deferred report. It never throws and nothing awaits it. */
const inBackground = (
	readHeaders: () => Headers,
	report: (
		posthogApi: typeof import("./posthog-api"),
		headers: Headers,
	) => Promise<void>,
): void => {
	try {
		// Read at once, while the request context is current.
		const headers = readHeaders();
		void import("./posthog-api")
			.then((posthogApi) => report(posthogApi, headers))
			.catch(logCaptureFailure);
	} catch (captureError) {
		console.error("server function capture failed", captureError);
	}
};

const reportInBackground = (
	error: Error,
	meta: FnMeta,
	readHeaders: () => Headers,
): void =>
	inBackground(readHeaders, ({ reportServerFnError }, headers) =>
		reportServerFnError(error, headers, meta),
	);

const reportIfSlow = (
	durationMs: number,
	threw: boolean,
	meta: FnMeta,
	readHeaders: () => Headers,
): void => {
	if (durationMs < SLOW_SERVER_FN_MS) return;
	inBackground(readHeaders, ({ reportSlowServerFn }, headers) =>
		reportSlowServerFn(headers, meta, { durationMs, threw }),
	);
};
