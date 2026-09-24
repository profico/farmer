import { z } from "zod";

/**
 * An OpenID Connect source on the Infrastructure page's Sign-in section. One
 * definition for the dialog's resolver, the server functions' validators and
 * `instanceSettingsService`, which parses again because it is callable from
 * elsewhere too.
 *
 * The messages read as whole sentences, because the same text is a line under
 * a box and a toast after a refused save.
 */

/** better-auth's own provider ids, and anything that would shadow a route.
 *  "credential" is the id better-auth gives a password account: a provider
 *  under it would write account rows the app reads as a password. */
const RESERVED_PROVIDER_IDS = new Set([
	"credential",
	"google",
	"github",
	"google-calendar",
]);

/** Part of the callback URL, so fixed once the source exists. */
export const oauthProviderIdSchema = z
	.string()
	.trim()
	.regex(
		/^[a-z0-9][a-z0-9-]{1,39}$/,
		"The ID must be 2 to 40 lowercase letters, digits or hyphens.",
	)
	.refine((id) => !RESERVED_PROVIDER_IDS.has(id), {
		error: (issue) => `"${String(issue.input)}" is a built-in provider.`,
	});

const isHttpUrl = (value: string) => {
	const url = URL.parse(value);
	return url?.protocol === "https:" || url?.protocol === "http:";
};

/** The fields a create, an edit and the dialog share. */
export const oauthProviderFieldsSchema = z.object({
	name: z.string().trim().min(1, "Enter a display name.").max(80),
	baseUrl: z
		.string()
		.trim()
		.max(500)
		.refine(isHttpUrl, "The base URL must be an http(s) URL."),
	clientId: z.string().trim().min(1, "Enter the client ID.").max(500),
	scopes: z.string().trim().max(500),
	/**
	 * The source checks every address it hands out, so an address without an
	 * `email_verified` claim counts as verified. For an identity provider that
	 * leaves the claim out (Entra ID's ID token does). Off by default: an
	 * unverified address never claims an invitation or links to an account.
	 */
	trustsEmail: z.boolean(),
});

export const createOAuthProviderInput = oauthProviderFieldsSchema.extend({
	providerId: oauthProviderIdSchema,
	clientSecret: z.string().trim().min(1, "Enter the client secret.").max(2_000),
	enabled: z.boolean(),
});

/** `clientSecret` left out keeps the stored one. `providerId` is not here: it
 *  never changes. */
export const updateOAuthProviderInput = oauthProviderFieldsSchema.extend({
	id: z.uuid(),
	clientSecret: z.string().trim().max(2_000).optional(),
	enabled: z.boolean(),
});

export type CreateOAuthProviderInput = z.input<typeof createOAuthProviderInput>;
export type UpdateOAuthProviderInput = z.input<typeof updateOAuthProviderInput>;
