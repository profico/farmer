// The signature, pinned to a vector.
//
// The point of the first test is that it does NOT call the signer to work out
// what to expect. A hand-computed digest is what catches the change that
// silently alters what is signed — dropping the timestamp from the signed
// string, say, which every round-trip test in the world still passes while the
// scheme stops stopping replays.

import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import {
	generateWebhookSecret,
	parseWebhookSignature,
	verifyWebhookSignature,
	WEBHOOK_SECRET_PREFIX,
	webhookSecretHint,
	webhookSignatureHeader,
} from "./webhook-signature";

const SECRET = "whsec_test_secret";

const BODY = '{"id":"evt_1","kind":"webhook.test"}';

const T = 1_758_096_662;

describe("the signed string", () => {
	test("is the timestamp, a dot, and the raw body", () => {
		// Computed here from first principles, not from the module under test.
		const expected = createHmac("sha256", SECRET)
			.update(`${String(T)}.${BODY}`, "utf8")
			.digest("hex");

		expect(webhookSignatureHeader([SECRET], BODY, T)).toBe(
			`t=${String(T)},v1=${expected}`,
		);
	});

	test("a different timestamp is a different signature", () => {
		const a = webhookSignatureHeader([SECRET], BODY, T);
		const b = webhookSignatureHeader([SECRET], BODY, T + 1);
		expect(a).not.toBe(b);
	});

	test("a rolled secret signs the same payload twice, in one header", () => {
		const header = webhookSignatureHeader([SECRET, "whsec_old"], BODY, T);
		const parsed = parseWebhookSignature(header);
		expect(parsed?.signatures).toHaveLength(2);
		// Either secret satisfies a receiver, which is what makes a roll
		// something a receiver can absorb at its own pace.
		expect(
			verifyWebhookSignature({ header, body: BODY, secret: SECRET, now: T }),
		).toBe(true);
		expect(
			verifyWebhookSignature({
				header,
				body: BODY,
				secret: "whsec_old",
				now: T,
			}),
		).toBe(true);
	});
});

describe("verification", () => {
	const header = webhookSignatureHeader([SECRET], BODY, T);

	test("accepts what it signed", () => {
		expect(
			verifyWebhookSignature({ header, body: BODY, secret: SECRET, now: T }),
		).toBe(true);
	});

	test("refuses a body that changed by one byte", () => {
		expect(
			verifyWebhookSignature({
				header,
				body: `${BODY} `,
				secret: SECRET,
				now: T,
			}),
		).toBe(false);
	});

	test("refuses another secret", () => {
		expect(
			verifyWebhookSignature({
				header,
				body: BODY,
				secret: "whsec_other",
				now: T,
			}),
		).toBe(false);
	});

	// The replay rule. A capture from an hour ago carries an hour-old `t`, and
	// re-signing it would need the secret.
	test("refuses a signature older than the tolerance", () => {
		expect(
			verifyWebhookSignature({
				header,
				body: BODY,
				secret: SECRET,
				now: T + 60,
			}),
		).toBe(true);
		expect(
			verifyWebhookSignature({
				header,
				body: BODY,
				secret: SECRET,
				now: T + 3600,
			}),
		).toBe(false);
	});

	test("refuses a clock far ahead of ours too", () => {
		expect(
			verifyWebhookSignature({
				header,
				body: BODY,
				secret: SECRET,
				now: T - 3600,
			}),
		).toBe(false);
	});

	test("refuses a header that is not one", () => {
		for (const bad of ["", "nonsense", `t=${String(T)}`, "v1=abc"]) {
			expect(
				verifyWebhookSignature({
					header: bad,
					body: BODY,
					secret: SECRET,
					now: T,
				}),
			).toBe(false);
		}
	});
});

describe("secrets", () => {
	test("carry the prefix and are not guessable", () => {
		const a = generateWebhookSecret();
		const b = generateWebhookSecret();
		expect(a.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
		expect(a).not.toBe(b);
		expect(a.length).toBeGreaterThan(40);
	});

	test("the hint is four characters and nothing more", () => {
		expect(webhookSecretHint("whsec_abcdefgh")).toBe("efgh");
	});
});
