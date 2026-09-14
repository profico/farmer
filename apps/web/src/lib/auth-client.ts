import {
	deviceAuthorizationClient,
	genericOAuthClient,
	organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	plugins: [
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

// `signUp` is here for the development-only email + password form on /login
// (packages/core/src/lib/dev-auth.ts). In production the endpoint behind it does
// not exist: Google is the only identity, and its callback creates the user on
// first sign-in, so there is nothing for a sign-up call to do.
export const { useSession, signIn, signUp, signOut } = authClient;
