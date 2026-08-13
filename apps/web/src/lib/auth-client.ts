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

// No `signUp`: Google is the only identity, and its callback creates the user
// on first sign-in. There is nothing for a sign-up call to do.
export const { useSession, signIn, signOut } = authClient;
