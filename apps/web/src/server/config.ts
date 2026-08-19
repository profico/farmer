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
			{ isDevAuthEnabled },
		] = await Promise.all([
			import("@farmer/core/lib/single-org"),
			import("@farmer/core/lib/assistant-flag"),
			import("@farmer/core/lib/dev-auth"),
		]);
		const assistantEnabled = isAssistantEnabled();
		const devAuth = isDevAuthEnabled();
		if (!isSingleOrgMode()) {
			return { singleOrgMode: false, assistantEnabled, devAuth, org: null };
		}
		const org = await findSingleOrg();
		return {
			singleOrgMode: true,
			assistantEnabled,
			devAuth,
			org: org
				? { slug: org.slug, name: org.name, logo: org.logo ?? null }
				: null,
		};
	},
);
