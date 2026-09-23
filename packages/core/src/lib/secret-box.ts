import crypto from "node:crypto";

// Encryption at rest for the credentials this app stores itself — the org's
// OpenRouter key (`assistant_settings.api_key`) and its Slack bot token
// (`slack_installation.bot_token`). Both are bearer tokens for a third party,
// so a database dump or a read-only SQL injection used to hand them over
// verbatim. OAuth account tokens are not here: better-auth encrypts those
// itself (`account.encryptOAuthTokens` in `auth/index.ts`).
//
// AES-256-GCM, with the key derived (HKDF-SHA256) from BETTER_AUTH_SECRET, so
// a deployment has nothing new to configure. The derivation's `info` names
// this use, so the key is not the one better-auth derives from the same secret.
//
// A sealed value is `enc:v1:` + base64url(iv ‖ ciphertext ‖ tag). The prefix
// is what tells a sealed value from a row written before this existed:
// `openSecret` hands an unprefixed value back as it is, and the two loaders
// that call it rewrite such a row sealed on the spot — so existing rows heal
// on their next read, with no migration and no hand-run SQL. The version is
// in the prefix so a later scheme can be told apart the same way.
//
// SERVER ONLY — it reads `process.env`.

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cached: { secret: string; key: Buffer } | undefined;

const key = (): Buffer => {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error("BETTER_AUTH_SECRET not configured");
	if (cached?.secret !== secret) {
		cached = {
			secret,
			key: Buffer.from(
				crypto.hkdfSync("sha256", secret, "farmer", "farmer/secret-box/v1", 32),
			),
		};
	}
	return cached.key;
};

/** Whether `stored` was written by `sealSecret`. False for a legacy plaintext
 *  row, which the caller should reseal. */
export const isSealed = (stored: string): boolean => stored.startsWith(PREFIX);

/** Encrypts a credential for storage. Throws when BETTER_AUTH_SECRET is unset,
 *  rather than storing the credential in the clear. */
export const sealSecret = (plaintext: string): string => {
	const iv = crypto.randomBytes(IV_BYTES);
	const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
	const body = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	return `${PREFIX}${Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url")}`;
};

/** The credential inside a stored value. An unsealed (legacy plaintext) value
 *  comes back unchanged. Throws when a sealed value does not decrypt — a
 *  changed BETTER_AUTH_SECRET, or a tampered row — so a caller never uses
 *  garbage as a token. */
export const openSecret = (stored: string): string => {
	if (!isSealed(stored)) return stored;
	const raw = Buffer.from(stored.slice(PREFIX.length), "base64url");
	if (raw.length < IV_BYTES + TAG_BYTES) {
		throw new Error("Stored secret is truncated");
	}
	const decipher = crypto.createDecipheriv(
		"aes-256-gcm",
		key(),
		raw.subarray(0, IV_BYTES),
	);
	decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
	return Buffer.concat([
		decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)),
		decipher.final(),
	]).toString("utf8");
};

/**
 * What a loader calls on a stored credential: the plaintext, or null when the
 * stored value does not decrypt (logged, never thrown — the caller treats it as
 * "not configured", which a reconnect fixes).
 *
 * A legacy plaintext value is resealed through `reseal`, which should write
 * the sealed value back only where the column still holds the old one, so a
 * concurrent reconnect is never overwritten. A failed reseal is logged and the
 * read still succeeds; the next read tries again.
 */
/** Stored values already reported as unreadable. After a changed
 *  BETTER_AUTH_SECRET every page view and every reminder tick reads the same
 *  value again, and one log line with a stack for each read buried the rest of
 *  the log. One line per stored value says the same. Cleared when it grows
 *  past the limit, so a long-lived process cannot keep old values forever. */
const reportedUnreadable = new Set<string>();
const REPORTED_UNREADABLE_LIMIT = 1000;

export const openAndHeal = async (
	stored: string,
	reseal: (sealed: string) => Promise<void>,
	what: string,
): Promise<string | null> => {
	let plaintext: string;
	try {
		plaintext = openSecret(stored);
	} catch (error) {
		if (!reportedUnreadable.has(stored)) {
			if (reportedUnreadable.size >= REPORTED_UNREADABLE_LIMIT) {
				reportedUnreadable.clear();
			}
			reportedUnreadable.add(stored);
			console.error(`[secret-box] ${what} does not decrypt`, { error });
		}
		return null;
	}
	if (!isSealed(stored)) {
		try {
			await reseal(sealSecret(plaintext));
		} catch (error) {
			console.error(`[secret-box] resealing ${what} failed`, { error });
		}
	}
	return plaintext;
};
