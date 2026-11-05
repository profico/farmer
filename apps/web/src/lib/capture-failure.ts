/**
 * Send the unexpected failure of a server function to PostHog error tracking.
 *
 * The error is always rethrown as it came, at once. TanStack hands the error
 * of `next()` back to the client, so the capture must not change it or delay
 * it: it runs after the throw and is never awaited. A failure of the capture
 * is logged and dropped. Only a fault is captured: see `isServerFnFault`. The
 * person is read from the session because the middleware runs before
 * `orgMiddleware`, so it has no `ctx`.
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
): Promise<T> => {
	try {
		return await next();
	} catch (error) {
		if (error instanceof Error) {
			await reportInBackground(error, serverFnMeta, readHeaders);
		}
		throw error;
	}
};

const reportInBackground = async (
	error: Error,
	meta: { name: string; filename: string },
	readHeaders: () => Headers,
): Promise<void> => {
	try {
		const { reportServerFnError } = await import("./posthog-api");
		void reportServerFnError(error, readHeaders(), meta).catch((captureError) =>
			console.error("server function capture failed", captureError),
		);
	} catch (captureError) {
		console.error("server function capture failed", captureError);
	}
};
