import { z } from "zod";

import { API_TOKEN_SCOPES } from "../api/tokens";

/** How long a new token lives, in days. Null never expires. A closed list, so
 *  the form and the service cannot disagree about what "a year" means. */
export const API_TOKEN_LIFETIMES = [30, 90, 365] as const;

export const createApiTokenInput = z.object({
	/** What the token is for, so the person can tell two apart in the list. */
	name: z
		.string()
		.trim()
		.min(1, "Give the token a name.")
		.max(80, "Use 80 characters or fewer."),
	scope: z.enum(API_TOKEN_SCOPES),
	/** `this` binds the token to the workspace it was made in; `all` lets it
	 *  name any workspace its owner is in. */
	workspace: z.enum(["this", "all"]),
	/** Days, or null for a token that never expires. */
	expiresInDays: z
		.union([z.literal(30), z.literal(90), z.literal(365)])
		.nullable(),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenInput>;

export const apiTokenIdInput = z.uuid();
export type ApiTokenIdInput = z.infer<typeof apiTokenIdInput>;
