import { createServerFn } from "@tanstack/react-start";

/**
 * Deployment shape the client is allowed to know, resolved server-side.
 *
 * `SINGLE_ORG_SLUG` is a plain env var, not a `VITE_` one, on purpose: `VITE_`
 * variables are baked at build time, and the Dockerfile builds one image that
 * is meant to run under different environments. So the mode is read on the
 * server, per request, and handed to the client through this function.
 */
export type PublicAppConfig = {
	singleOrgMode: boolean;
	/**
	 * Whether the assistant runs on this deployment (`ASSISTANT_ENABLED`).
	 *
	 * What the client does with this is presentation — hide the nav row, refuse
	 * the route. The switch that actually closes the feature is server-side, in
	 * `assistantService` and the streaming route; same relationship as
	 * `allowUserToCreateOrganization` and the hidden "New organization" item.
	 */
	assistantEnabled: boolean;
	/**
	 * Whether the MCP server runs on this deployment (`MCP_ENABLED`).
	 *
	 * Its own flag, not `assistantEnabled`. The two features share a tool
	 * registry and nothing else — see `packages/core/src/lib/mcp-flag.ts` — so
	 * an operator who has switched the assistant off has said nothing about
	 * this one. Used to decide whether Settings → Integrations shows the
	 * connection URL, which is the only place anybody can find it.
	 */
	mcpEnabled: boolean;
	/**
	 * This deployment's own origin, from `BETTER_AUTH_URL`.
	 *
	 * Resolved on the server rather than read from `window.location` in the
	 * browser, because it is not "wherever this tab happens to be". It is the
	 * origin better-auth publishes in both OAuth discovery documents, so it is
	 * the one an MCP client must be handed — an alternate hostname or a preview
	 * URL that renders the same page would produce a connection string that
	 * discovers a resource it is not allowed to be.
	 *
	 * Empty when `BETTER_AUTH_URL` is unset, which is a broken deployment for
	 * other reasons already (invitation links and the OAuth callbacks need it).
	 * Callers show nothing rather than a half-built URL.
	 */
	appOrigin: string;
	/**
	 * Whether `/login` should offer the email + password form alongside the
	 * Google button (`packages/core/src/lib/dev-auth.ts`).
	 *
	 * Same relationship as `assistantEnabled`: this only decides whether the
	 * form renders. What actually closes password sign-in is better-auth's
	 * `emailAndPassword.enabled`, server-side — a form typed into by hand
	 * against a production build gets a 404 from the endpoint.
	 */
	devAuth: boolean;
	/**
	 * The one organization's public face — name, logo and slug, and nothing
	 * else. This is an unauthenticated read (`/login`'s error screen needs it
	 * before anyone has signed in), so it returns branding rather than the org
	 * row.
	 *
	 * Null while `singleOrgMode` is true means the mode is on but the instance
	 * has not been claimed yet: the first person to sign in creates it.
	 */
	org: { slug: string; name: string; logo: string | null } | null;
};

export const getPublicAppConfig = createServerFn({ method: "GET" }).handler(
	async (): Promise<PublicAppConfig> => {
		const [
			{ isSingleOrgMode, findSingleOrg },
			{ isAssistantEnabled },
			{ isMcpEnabled },
			{ isDevAuthEnabled },
		] = await Promise.all([
			import("@farmer/core/lib/single-org"),
			import("@farmer/core/lib/assistant-flag"),
			import("@farmer/core/lib/mcp-flag"),
			import("@farmer/core/lib/dev-auth"),
		]);
		const assistantEnabled = isAssistantEnabled();
		const mcpEnabled = isMcpEnabled();
		const devAuth = isDevAuthEnabled();
		// Parsed rather than passed through, so a trailing path or slash in the
		// environment cannot end up doubled in the middle of a URL somebody
		// pastes. An unparseable value is the same answer as a missing one.
		const appOrigin =
			URL.parse(process.env.BETTER_AUTH_URL ?? "")?.origin ?? "";
		if (!isSingleOrgMode()) {
			return {
				singleOrgMode: false,
				assistantEnabled,
				mcpEnabled,
				appOrigin,
				devAuth,
				org: null,
			};
		}
		const org = await findSingleOrg();
		return {
			singleOrgMode: true,
			assistantEnabled,
			mcpEnabled,
			appOrigin,
			devAuth,
			org: org
				? { slug: org.slug, name: org.name, logo: org.logo ?? null }
				: null,
		};
	},
);
