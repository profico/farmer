import { symmetricEncrypt } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { account } from "../db/schema/auth";
import { auth } from "./index";

// Self-heal for OAuth tokens stored before `account.encryptOAuthTokens` was on.
//
// better-auth reads such a row fine — `decryptOAuthToken` hands back a value
// that does not look encrypted as it is — but it only ever rewrites a token
// when the provider issues a new one. Google keeps the same refresh token for
// the life of the grant and a GitHub OAuth token never expires, so without
// this those rows would stay plaintext until the person reconnected.

/** better-auth's own test for "this is ciphertext" (`isLikelyEncrypted` in
 *  better-auth/dist/oauth2/utils.mjs, not exported). It must match exactly: a
 *  value this calls plaintext gets encrypted, and encrypting ciphertext a
 *  second time would make the token unreadable. */
const looksEncrypted = (token: string) =>
	token.startsWith("$ba$") ||
	(token.length % 2 === 0 && /^[0-9a-f]+$/i.test(token));

/**
 * Encrypts whichever of an account row's two tokens is still plaintext.
 *
 * Each write is conditional on the column still holding the value that was
 * read, so a refresh or a reconnect that lands in between is never
 * overwritten. Never throws: a failure is logged and the next use retries.
 */
export const sealLegacyOAuthTokens = async (row: {
	id: string;
	accessToken: string | null;
	refreshToken: string | null;
}): Promise<void> => {
	const columns = [
		["accessToken", row.accessToken],
		["refreshToken", row.refreshToken],
	] as const;
	const legacy = columns.filter(
		(entry): entry is readonly [(typeof entry)[0], string] =>
			entry[1] !== null && entry[1] !== "" && !looksEncrypted(entry[1]),
	);
	if (legacy.length === 0) return;
	try {
		// What better-auth's `setTokenUtil` does with `encryptOAuthTokens` on, so
		// the result is exactly what `decryptOAuthToken` expects to read.
		const { secretConfig } = await auth.$context;
		for (const [column, plaintext] of legacy) {
			const sealed = await symmetricEncrypt({
				key: secretConfig,
				data: plaintext,
			});
			await db
				.update(account)
				.set({ [column]: sealed })
				.where(and(eq(account.id, row.id), eq(account[column], plaintext)));
		}
	} catch (error) {
		console.error("[auth] sealing a legacy OAuth token failed", {
			accountId: row.id,
			error,
		});
	}
};
