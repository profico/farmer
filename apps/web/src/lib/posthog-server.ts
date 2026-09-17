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
 *
 * **Development sends nothing, whatever the environment says.** A developer's
 * `.env` is a copy of a real deployment's, token included, so without this gate
 * every reload, every test click and every seeded row would land in the same
 * project the dashboards are built on — indistinguishable from a customer, and
 * un-deletable once counted. The gate is `NODE_ENV !== "production"`, the same
 * one `lib/dev-auth.ts` uses and for the same reason: an opt-in variable can be
 * copied onto a server, whereas the only host that sets `NODE_ENV=production`
 * is a host that is serving people. `vite dev` never does; the Dockerfile and
 * `apps/web`'s `start` script both pin it. The browser half is gated the same
 * way, in `routes/__root.tsx` — it never receives the credentials at all.
 */
let posthogClient: PostHog | null = null;

export const posthogServerConfig = (): {
	token: string;
	host: string;
} | null => {
	if (process.env.NODE_ENV !== "production") return null;
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
