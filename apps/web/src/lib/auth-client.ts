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

export const { useSession, signIn, signOut, signUp } = authClient;
