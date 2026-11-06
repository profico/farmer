import { randomBytes } from "node:crypto";

import { hashSecret, secretMatches } from "./ids";
import type { ServerKey } from "./store";

export type MintedKey = { id: string; key: string; hash: string };

/** A server key is `<id>.<secret>`. The id is public, and the relay finds
 *  the row by it. The secret is 256 random bits, and the relay keeps only its
 *  SHA-256 hash. */
export const newServerKey = (): MintedKey => {
	const id = randomBytes(6).toString("hex");
	const secret = randomBytes(32).toString("base64url");
	return { id, key: `${id}.${secret}`, hash: hashSecret(secret) };
};

/** A fixed hash to compare with when the key id is unknown, so a wrong id and
 *  a wrong secret take the same time. */
const NO_KEY_HASH = hashSecret("no server key");

export type KeyCheck =
	| { ok: true; key: ServerKey }
	| { ok: false; reason: "invalid" | "revoked" };

/** Check a presented key against the store. */
export const checkServerKey = (
	presented: string,
	find: (id: string) => ServerKey | null,
): KeyCheck => {
	const [id = "", secret = ""] = presented.split(".", 2);
	const key = find(id);
	const matches = secretMatches(secret, key?.secretHash ?? NO_KEY_HASH);
	if (!key || !matches) return { ok: false, reason: "invalid" };
	return key.revokedAt === null
		? { ok: true, key }
		: { ok: false, reason: "revoked" };
};
