import { setting } from "@farmer/core/lib/instance-settings";
import { PostHog } from "posthog-node";

/**
 * The server-side PostHog client, or null on a deployment without one.
 *
 * Reads the instance settings (`@farmer/core/lib/instance-settings`: the
 * environment, else the Infrastructure page) rather than `VITE_` variables, and
 * so does the browser half — see `posthogConfig` in `routes/__root.tsx`. A
 * `VITE_` value is substituted by `vite build`, which runs inside the Docker
 * image, so it can only ever hold what CI was given and never what a
 * deployment is configured with.
 *
 * The client is kept with the token and host it was built from and rebuilt
 * when they change, so a token fixed on the page is used without a restart.
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
let posthogClient: { key: string; client: PostHog } | null = null;

export const posthogServerConfig = (): {
	token: string;
	host: string;
} | null => {
	if (process.env.NODE_ENV !== "production") return null;
	const token = setting("POSTHOG_PROJECT_TOKEN");
	const host = setting("POSTHOG_HOST");
	if (!token || !host) return null;
	return { token, host };
};

export function getPostHogClient(): PostHog | null {
	const config = posthogServerConfig();
	if (!config) return null;
	const key = `${config.host}\n${config.token}`;
	if (posthogClient?.key === key) return posthogClient.client;

	// The old client flushes what it holds before it goes; nothing waits on it.
	void posthogClient?.client.shutdown();
	const client = new PostHog(config.token, {
		host: config.host,
		flushAt: 1,
		flushInterval: 0,
		enableExceptionAutocapture: true,
	});
	posthogClient = { key, client };
	return client;
}
