import {
	adminClient,
	deviceAuthorizationClient,
	genericOAuthClient,
	organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	plugins: [
		// Two calls out of this plugin are used, both from Settings → People and
		// the sidebar: `admin.impersonateUser` and `admin.stopImpersonating`. Both
		// swap the session cookie on the server, so both callers follow with a
		// full document load rather than a router invalidation — see
		// `lib/impersonation.ts`.
		//
		// No `roles` here, unlike the server plugin (`packages/core/src/auth`).
		// That option only types `admin.checkRolePermission`, which nothing calls;
		// who may impersonate is decided on the server, where the role lives.
		adminClient(),
		// The approval half of `farmer login` (routes/device.tsx). The CLI itself
		// does not use this client: it speaks the device endpoints over plain
		// HTTP, and only the browser that approves the code needs the typed calls.
		deviceAuthorizationClient(),
		organizationClient({
			schema: {
				organization: {
					additionalFields: {
						timezone: { type: "string", required: true },
						country: { type: "string", required: true },
					},
				},
			},
		}),
		genericOAuthClient(),
	],
});

// `signUp` is here for the email + password form on /login: the development
// form (packages/core/src/lib/dev-auth.ts), and in production the form that
// creates the instance's first account. The server refuses every other
// production sign-up; see `emailAndPassword` in packages/core/src/auth. A
// provider's callback creates the user on first sign-in, so the provider
// paths never call it. `genericOAuthClient` above gives `signIn.oauth2`, the
// button for each OpenID Connect source.
export const { useSession, signIn, signUp, signOut } = authClient;
