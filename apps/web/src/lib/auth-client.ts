import {
	genericOAuthClient,
	organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	plugins: [
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

// `signUp` is here for the development-only email + password form on /login
// (packages/core/src/lib/dev-auth.ts). In production the endpoint behind it does
// not exist: Google is the only identity, and its callback creates the user on
// first sign-in, so there is nothing for a sign-up call to do.
export const { useSession, signIn, signUp, signOut } = authClient;
