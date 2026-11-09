import { createServerFn } from "@tanstack/react-start";

/**
 * Deployment shape the client is allowed to know, resolved server-side.
 *
 * `SINGLE_ORG_SLUG` and the feature switches are instance settings
 * (`@farmer/core/lib/instance-settings`), never `VITE_` variables: those are
 * baked at build time, and the Dockerfile builds one image that is meant to
 * run under different environments. So each is read on the server, per
 * request, and handed to the client through this function.
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
	 * Whether the command-line tool runs on this deployment (`CLI_ENABLED`).
	 *
	 * Its own flag again, independent of the other two — see
	 * `packages/core/src/lib/cli-flag.ts`. The client reads it for presentation
	 * only: Settings → Integrations shows the install commands, and `/device`
	 * renders not-found. What actually closes the CLI is server-side — the
	 * device endpoints, `/api/v1/orgs/*` and the install script all answer 404
	 * — so a page typed in by hand has nothing behind it to approve.
	 */
	cliEnabled: boolean;
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
	 * The sign-in buttons `/login` draws: Google when it has credentials, then
	 * each OpenID Connect source switched on in Infrastructure → Sign-in
	 * (`signInProviders` in `packages/core/src/auth/sign-in-methods.ts`). An id
	 * and a label each, never a secret. Empty means no provider is configured.
	 */
	signInProviders: { id: string; name: string; kind: "social" | "oidc" }[];
	/**
	 * Whether Google is one of them. `/login` bounces straight to Google, with
	 * no page, when it is the only way in; see `routes/login.tsx`.
	 */
	googleSignIn: boolean;
	/**
	 * Whether this deployment has an object store for uploaded project icons
	 * and organization logos (`S3_*`, `packages/core/src/lib/storage.ts`).
	 *
	 * Presentation again: it decides whether the upload controls render. With
	 * no store the upload server function refuses on its own.
	 */
	uploadsEnabled: boolean;
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
	/**
	 * The GitHub repository this deployment is built from, as `owner/name`
	 * (`@farmer/core/lib/source-repository`). The "Report a problem" and
	 * "View on GitHub" links read it, so a fork links to itself.
	 */
	repository: string;
};

export const getPublicAppConfig = createServerFn({ method: "GET" }).handler(
	async (): Promise<PublicAppConfig> => {
		const [
			{ signInProviders },
			{ isSingleOrgMode, findSingleOrg },
			{ isAssistantEnabled },
			{ isMcpEnabled },
			{ isCliEnabled },
			{ isDevAuthEnabled },
			{ isStorageEnabled },
			{ sourceRepository, DEFAULT_SOURCE_REPOSITORY },
		] = await Promise.all([
			import("@farmer/core/auth"),
			import("@farmer/core/lib/single-org"),
			import("@farmer/core/lib/assistant-flag"),
			import("@farmer/core/lib/mcp-flag"),
			import("@farmer/core/lib/cli-flag"),
			import("@farmer/core/lib/dev-auth"),
			import("@farmer/core/lib/storage"),
			import("@farmer/core/lib/source-repository"),
		]);
		const assistantEnabled = isAssistantEnabled();
		const mcpEnabled = isMcpEnabled();
		const cliEnabled = isCliEnabled();
		const devAuth = isDevAuthEnabled();
		const uploadsEnabled = isStorageEnabled();
		const providers = signInProviders();
		const googleSignIn = providers.some((provider) => provider.id === "google");
		const repository = sourceRepository() ?? DEFAULT_SOURCE_REPOSITORY;
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
				cliEnabled,
				appOrigin,
				devAuth,
				signInProviders: providers,
				googleSignIn,
				uploadsEnabled,
				org: null,
				repository,
			};
		}
		const org = await findSingleOrg();
		return {
			singleOrgMode: true,
			assistantEnabled,
			mcpEnabled,
			cliEnabled,
			appOrigin,
			devAuth,
			signInProviders: providers,
			googleSignIn,
			uploadsEnabled,
			org: org
				? { slug: org.slug, name: org.name, logo: org.logo ?? null }
				: null,
			repository,
		};
	},
);

/**
 * What `/login` offers for a password outside development: the form that
 * creates the first account, the form a platform admin who has no provider
 * yet signs in with, or nothing. See `passwordSignIn` in
 * `packages/core/src/auth/sign-in-methods.ts`, and the `emailAndPassword`
 * comment in `packages/core/src/auth/index.ts` for the gates behind it.
 *
 * Its own function rather than a field of `getPublicAppConfig`, because it
 * reads the database and only `/login` needs it; the config runs on every
 * navigation into a workspace.
 */
export const getPasswordSignIn = createServerFn({ method: "GET" }).handler(
	async (): Promise<"first-account" | "administrator" | null> => {
		const { passwordSignIn } = await import("@farmer/core/auth");
		return passwordSignIn();
	},
);

/**
 * The workspace slug that `/` redirects to. In single-organization mode it is
 * the one workspace. Otherwise, and before anyone has claimed the instance, it
 * is the `_` placeholder, which `/$orgSlug`'s guard resolves: sign-in, the only
 * workspace, the chooser or `/no-access`.
 *
 * Its own function because `/` runs for every anonymous visitor and needs
 * only this.
 */
export const getHomeRedirect = createServerFn({ method: "GET" }).handler(
	async (): Promise<string> => {
		const { findSingleOrg } = await import("@farmer/core/lib/single-org");
		const org = await findSingleOrg();
		return org?.slug ?? "_";
	},
);
