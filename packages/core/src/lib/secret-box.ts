import crypto from "node:crypto";

// Encryption at rest for the third-party credentials that this app stores:
// the org's OpenRouter key, its Slack bot token and the instance's secret
// settings. The columns: `assistant_settings.api_key`,
// `slack_installation.bot_token`, `instance_setting` and
// `instance_oauth_provider.client_secret`. better-auth encrypts OAuth account
// tokens itself (`account.encryptOAuthTokens` in `auth/index.ts`).
//
// AES-256-GCM. The key comes from HKDF-SHA256 over the better-auth secrets, so
// a deployment needs no new setting. The derivation `info` names this use, so
// the key differs from the key that better-auth derives from the same secret.
//
// Two stored forms, both base64url(iv ‖ ciphertext ‖ tag) behind a prefix:
//
// - `enc:v1:<data>` - keyed from BETTER_AUTH_SECRET. `sealSecret` writes it
//   when BETTER_AUTH_SECRETS is not set.
// - `enc:v2:<version>:<data>` - keyed from that version in BETTER_AUTH_SECRETS.
//   `sealSecret` writes it when BETTER_AUTH_SECRETS is set.
//
// Rotation follows better-auth (`secret-utils.mjs`). BETTER_AUTH_SECRETS is a
// comma-separated list of `<version>:<secret>`. The first entry seals. The
// other entries only open. Opening is a direct version lookup, never a trial
// decryption. A version that is not in the list fails like a bad decrypt.
//
// `openSecret` returns an unprefixed value as it is, because older rows hold
// plaintext. `openAndHeal` and the instance settings loader rewrite a value
// that is plaintext or sealed under an old key, so rows heal on the next read.
//
// SERVER ONLY: it reads `process.env`.

const V1 = "enc:v1:";
const V2 = "enc:v2:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const deriveKey = (secret: string): Buffer =>
	Buffer.from(
		crypto.hkdfSync("sha256", secret, "farmer", "farmer/secret-box/v1", 32),
	);

/** BETTER_AUTH_SECRETS, parsed and checked as better-auth parses and checks it
 *  (`parseSecretsEnv` + `validateSecretsArray`). Null when unset or empty. */
const parseRotation = (
	env: string | undefined,
): { current: number; secrets: Map<number, string> } | null => {
	if (!env) return null;
	const secrets = new Map<number, string>();
	let current: number | undefined;
	for (const raw of env.split(",")) {
		const entry = raw.trim();
		const colon = entry.indexOf(":");
		if (colon === -1) {
			throw new Error(
				`Invalid BETTER_AUTH_SECRETS entry: expected "<version>:<secret>"`,
			);
		}
		const version = Number.parseInt(entry.slice(0, colon), 10);
		if (!Number.isInteger(version) || version < 0) {
			throw new Error(
				"Invalid version in BETTER_AUTH_SECRETS: it must be a non-negative integer",
			);
		}
		const value = entry.slice(colon + 1).trim();
		if (!value) {
			throw new Error(
				`Empty secret for version ${version} in BETTER_AUTH_SECRETS`,
			);
		}
		if (secrets.has(version)) {
			throw new Error(`Duplicate version ${version} in BETTER_AUTH_SECRETS`);
		}
		secrets.set(version, value);
		current ??= version;
	}
	if (current === undefined) return null;
	return { current, secrets };
};

/** The secret new values are keyed from, picked as better-auth picks it: the
 *  first (current) BETTER_AUTH_SECRETS entry when the set is configured, else
 *  BETTER_AUTH_SECRET. For a MAC that must move with a rotation rather than
 *  stay on the legacy secret (`oauth-state.ts`). */
export const currentAuthSecret = (): string => {
	const rotation = parseRotation(process.env.BETTER_AUTH_SECRETS);
	const secret = rotation
		? rotation.secrets.get(rotation.current)
		: process.env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error("BETTER_AUTH_SECRET not configured");
	return secret;
};

type Keyring = {
	/** From BETTER_AUTH_SECRET; opens `enc:v1:`, and seals when there is no
	 *  rotation set. */
	legacy: Buffer | undefined;
	/** From BETTER_AUTH_SECRETS, when it is set. */
	rotation: { current: number; keys: Map<number, Buffer> } | null;
};

let cached: { env: string; keyring: Keyring } | undefined;

const keyring = (): Keyring => {
	const legacySecret = process.env.BETTER_AUTH_SECRET;
	const rotationEnv = process.env.BETTER_AUTH_SECRETS;
	const env = `${legacySecret ?? ""}\n${rotationEnv ?? ""}`;
	if (cached?.env !== env) {
		const rotation = parseRotation(rotationEnv);
		cached = {
			env,
			keyring: {
				legacy: legacySecret ? deriveKey(legacySecret) : undefined,
				rotation: rotation && {
					current: rotation.current,
					keys: new Map(
						[...rotation.secrets].map(([version, secret]) => [
							version,
							deriveKey(secret),
						]),
					),
				},
			},
		};
	}
	return cached.keyring;
};

const legacyKey = (ring: Keyring): Buffer => {
	if (!ring.legacy) throw new Error("BETTER_AUTH_SECRET not configured");
	return ring.legacy;
};

/** Whether `stored` was written by `sealSecret`, under any key. False for a
 *  legacy plaintext row, which the caller should reseal. */
export const isSealed = (stored: string): boolean =>
	stored.startsWith(V1) || stored.startsWith(V2);

/** Whether `stored` is sealed under the key `sealSecret` uses now. False for
 *  plaintext and for a value sealed before a rotation: both should be
 *  resealed. */
export const isSealedWithCurrentKey = (stored: string): boolean => {
	const { rotation } = keyring();
	return rotation
		? stored.startsWith(`${V2}${rotation.current}:`)
		: stored.startsWith(V1);
};

/** Encrypts a credential for storage, under the current BETTER_AUTH_SECRETS
 *  version or, without one, under BETTER_AUTH_SECRET. Throws when neither is
 *  set, rather than storing the credential in the clear. */
export const sealSecret = (plaintext: string): string => {
	const ring = keyring();
	const current = ring.rotation?.current;
	const key =
		current === undefined ? legacyKey(ring) : ring.rotation?.keys.get(current);
	if (!key) throw new Error(`Secret version ${current} not found in keys`);
	const iv = crypto.randomBytes(IV_BYTES);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	const body = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const data = Buffer.concat([iv, body, cipher.getAuthTag()]).toString(
		"base64url",
	);
	return current === undefined ? `${V1}${data}` : `${V2}${current}:${data}`;
};

const decrypt = (key: Buffer, data: string): string => {
	const raw = Buffer.from(data, "base64url");
	if (raw.length < IV_BYTES + TAG_BYTES) {
		throw new Error("Stored secret is truncated");
	}
	const decipher = crypto.createDecipheriv(
		"aes-256-gcm",
		key,
		raw.subarray(0, IV_BYTES),
	);
	decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
	return Buffer.concat([
		decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)),
		decipher.final(),
	]).toString("utf8");
};

/** The credential inside a stored value. An unsealed (legacy plaintext) value
 *  comes back unchanged. Throws when a sealed value does not decrypt — a
 *  changed secret, a version retired from BETTER_AUTH_SECRETS, or a tampered
 *  row — so a caller never uses garbage as a token. */
export const openSecret = (stored: string): string => {
	if (stored.startsWith(V1)) {
		return decrypt(legacyKey(keyring()), stored.slice(V1.length));
	}
	if (!stored.startsWith(V2)) return stored;
	const rest = stored.slice(V2.length);
	const colon = rest.indexOf(":");
	const version = rest.slice(0, colon);
	if (colon === -1 || !/^\d+$/.test(version)) {
		throw new Error("Stored secret has no key version");
	}
	const key = keyring().rotation?.keys.get(Number(version));
	if (!key) {
		throw new Error(
			`Secret version ${version} not found in BETTER_AUTH_SECRETS (the key may have been retired)`,
		);
	}
	return decrypt(key, rest.slice(colon + 1));
};

/** Stored values already reported as unreadable. After a changed
 *  BETTER_AUTH_SECRET every page view and every reminder tick reads the same
 *  value again, and one log line with a stack for each read buried the rest of
 *  the log. One line per stored value says the same. Cleared when it grows
 *  past the limit, so a long-lived process cannot keep old values forever. */
const reportedUnreadable = new Set<string>();
const REPORTED_UNREADABLE_LIMIT = 1000;

/**
 * What a loader calls on a stored credential: the plaintext, or null when the
 * stored value does not decrypt (logged, never thrown — the caller treats it as
 * "not configured", which a reconnect fixes).
 *
 * A value that is legacy plaintext, or sealed under a key that is no longer
 * the current one, is resealed through `reseal`. That is how a rotation
 * reaches the stored rows. `reseal` should write the sealed value back only
 * where the column still holds the old one, so a concurrent reconnect is never
 * overwritten. A failed reseal is logged and the read still succeeds; the next
 * read tries again.
 */
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
	try {
		if (!isSealedWithCurrentKey(stored)) await reseal(sealSecret(plaintext));
	} catch (error) {
		console.error(`[secret-box] resealing ${what} failed`, { error });
	}
	return plaintext;
};
