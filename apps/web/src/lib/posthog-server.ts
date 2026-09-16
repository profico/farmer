import { PostHog } from "posthog-node";

/**
 * The server-side PostHog client, or null on a deployment without one.
 *
 * Reads plain environment variables rather than `VITE_` ones, and so does the
 * browser half — see `posthogConfig` in `routes/__root.tsx`. A `VITE_` value is
 * substituted by `vite build`, which runs inside the Docker image, so it can
 * only ever hold what CI was given and never what a deployment is configured
 * with. One image runs several environments here, which is the same reason
 * `ASSISTANT_ENABLED` and `SINGLE_ORG_SLUG` are plain variables.
 *
 * A missing token or host is "PostHog is not set up here", not a fault: every
 * caller gets null and carries on. Nothing about the product depends on
 * analytics being reachable.
 */
let posthogClient: PostHog | null = null;

export const posthogServerConfig = (): {
	token: string;
	host: string;
} | null => {
	const token = process.env.POSTHOG_PROJECT_TOKEN;
	const host = process.env.POSTHOG_HOST;
	if (!token || !host) return null;
	return { token, host };
};

export function getPostHogClient(): PostHog | null {
	if (posthogClient) return posthogClient;

	const config = posthogServerConfig();
	if (!config) return null;

	posthogClient = new PostHog(config.token, {
		host: config.host,
		flushAt: 1,
		flushInterval: 0,
		enableExceptionAutocapture: true,
	});
	return posthogClient;
}
