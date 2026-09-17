// Proving a webhook came from this deployment.
//
// The scheme is Stripe's, because a receiver has probably written it once
// already and because it is the one shape with libraries in every language:
//
//     Farmer-Signature: t=1758096662,v1=<hex>[,v1=<hex>]
//
// where each `v1` is the HMAC-SHA256 of the ASCII string `"<t>.<raw body>"`
// under one of the endpoint's live secrets.
//
// Three details are load-bearing and each answers an attack:
//
//   * **The timestamp is INSIDE the signed string.** A signature over the body
//     alone can be replayed for ever, because the attacker resends bytes that
//     were validly signed. Signing `t` with it means an old capture carries an
//     old `t`, and a receiver that enforces the tolerance refuses it.
//   * **The raw body, not a re-serialization.** A receiver that parses the JSON
//     and re-encodes it before checking will get a different byte string on the
//     first payload whose key order or unicode escaping differs. The docs say
//     to read the body as text first.
//   * **A constant-time compare.** `===` on a hex digest leaks where the first
//     differing byte is, which is enough to forge a signature one byte at a
//     time.
//
// A rolled secret produces two `v1` values for 24 hours (see `webhookEndpoint`
// in `db/schema/webhooks.ts`) so a receiver can be redeployed at its own pace.
// A verifier that checks "any v1 matches my secret" handles that with no
// change, which is why the header holds a list rather than a second header
// name.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** How far a receiver should let `t` drift before calling it a replay. Ours to
 *  document, theirs to enforce — nothing here reads it, and that is the point:
 *  the sender cannot check a receiver's clock. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

/** The prefix a Farmer signing secret carries, so one found in a log or a
 *  config file is recognisable as what it is. */
export const WEBHOOK_SECRET_PREFIX = "whsec_";

/** A fresh signing secret: 32 bytes of CSPRNG, base64url so it survives a
 *  round trip through an environment variable or a YAML file unescaped. */
export const generateWebhookSecret = (): string =>
	`${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;

/** The last four characters, which is all the settings page shows once the
 *  secret has been revealed — enough to tell two endpoints apart, useless to
 *  anyone who reads it. */
export const webhookSecretHint = (secret: string): string => secret.slice(-4);

const digest = (secret: string, signedPayload: string): string =>
	createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");

/**
 * The `Farmer-Signature` value for one delivery.
 *
 * `secrets` is the endpoint's live secrets, current first. More than one only
 * during the 24 hours after a roll.
 */
export const webhookSignatureHeader = (
	secrets: readonly string[],
	body: string,
	timestampSeconds: number,
): string => {
	const signedPayload = `${String(timestampSeconds)}.${body}`;
	const parts = secrets.map((secret) => `v1=${digest(secret, signedPayload)}`);

	return [`t=${String(timestampSeconds)}`, ...parts].join(",");
};

/** A parsed header: the timestamp it claims and every signature it offers. */
export type ParsedWebhookSignature = {
	timestampSeconds: number;
	signatures: string[];
};

/**
 * Read a `Farmer-Signature` value. Null when it is not one — a missing `t`, a
 * `t` that is not a number, or no `v1` at all.
 *
 * Here rather than only in the docs because the tests verify against it, and a
 * verifier this repo does not run is a verifier that drifts from the signer.
 */
export const parseWebhookSignature = (
	header: string,
): ParsedWebhookSignature | null => {
	let timestampSeconds: number | null = null;
	const signatures: string[] = [];

	for (const part of header.split(",")) {
		const separator = part.indexOf("=");

		if (separator === -1) continue;
		const key = part.slice(0, separator).trim();
		const value = part.slice(separator + 1).trim();

		if (key === "t") {
			const parsed = Number(value);

			if (Number.isInteger(parsed)) timestampSeconds = parsed;
		} else if (key === "v1" && value.length > 0) {
			signatures.push(value);
		}
	}

	if (timestampSeconds === null || signatures.length === 0) return null;

	return { timestampSeconds, signatures };
};

/** Constant-time equality over two hex digests of the same length. A length
 *  mismatch is a mismatch, and comparing lengths is not a leak — the digest's
 *  length is fixed and public. */
const digestsMatch = (a: string, b: string): boolean => {
	if (a.length !== b.length) return false;

	return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
};

/**
 * Whether `header` proves `body` was signed with `secret` recently.
 *
 * The reference implementation of what a receiver must do, and what the tests
 * check the signer against. Nothing in the delivery path calls it — Farmer
 * signs, it never verifies.
 */
export const verifyWebhookSignature = (input: {
	header: string;
	body: string;
	secret: string;
	/** Unix seconds. */
	now: number;
	toleranceSeconds?: number;
}): boolean => {
	const parsed = parseWebhookSignature(input.header);

	if (!parsed) return false;

	const tolerance =
		input.toleranceSeconds ?? WEBHOOK_SIGNATURE_TOLERANCE_SECONDS;

	// Both directions: a clock ahead of ours is as much a reason to refuse as a
	// capture from an hour ago.
	if (Math.abs(input.now - parsed.timestampSeconds) > tolerance) return false;

	const expected = digest(
		input.secret,
		`${String(parsed.timestampSeconds)}.${input.body}`,
	);

	return parsed.signatures.some((candidate) =>
		digestsMatch(candidate, expected),
	);
};
