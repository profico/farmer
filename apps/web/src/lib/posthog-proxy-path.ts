// The route file `routes/api/k7v2q9/$.ts` must match this prefix.
export const POSTHOG_PROXY_PATH = "/api/k7v2q9";

const CLOUD_HOST = /^https:\/\/(us|eu)\.i\.posthog\.com\/?$/;

/** The PostHog Cloud region of a host, or null for a self-hosted instance. */
export const posthogCloudRegion = (host: string): string | null =>
	CLOUD_HOST.exec(host)?.[1] ?? null;
