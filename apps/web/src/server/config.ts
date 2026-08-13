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
		const { isSingleOrgMode, findSingleOrg } = await import(
			"@farmer/core/lib/single-org"
		);
		if (!isSingleOrgMode()) return { singleOrgMode: false, org: null };
		const org = await findSingleOrg();
		return {
			singleOrgMode: true,
			org: org
				? { slug: org.slug, name: org.name, logo: org.logo ?? null }
				: null,
		};
	},
);
