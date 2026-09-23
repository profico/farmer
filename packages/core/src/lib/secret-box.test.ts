import { describe, expect, spyOn, test } from "bun:test";

import { isSealed, openAndHeal, openSecret, sealSecret } from "./secret-box";

describe("sealSecret / openSecret", () => {
	test("round-trips, and the stored form does not carry the secret", () => {
		const sealed = sealSecret("xoxb-1234-secret");
		expect(isSealed(sealed)).toBe(true);
		expect(sealed.startsWith("enc:v1:")).toBe(true);
		expect(sealed).not.toContain("xoxb-1234-secret");
		expect(openSecret(sealed)).toBe("xoxb-1234-secret");
	});

	test("seals the same secret differently each time", () => {
		expect(sealSecret("same")).not.toBe(sealSecret("same"));
	});

	test("hands a legacy plaintext value back unchanged", () => {
		expect(isSealed("sk-or-v1-legacy")).toBe(false);
		expect(openSecret("sk-or-v1-legacy")).toBe("sk-or-v1-legacy");
	});

	test("refuses a tampered value rather than returning garbage", () => {
		const sealed = sealSecret("sk-or-v1-abc");
		// A character in the middle: the last one of a base64url string can carry
		// only padding bits, so flipping it may not change a single byte.
		const at = Math.floor(sealed.length / 2);
		const flipped = sealed[at] === "A" ? "B" : "A";
		expect(() =>
			openSecret(`${sealed.slice(0, at)}${flipped}${sealed.slice(at + 1)}`),
		).toThrow(/auth/i);
		expect(() => openSecret("enc:v1:c2hvcnQ")).toThrow(/truncated/);
	});

	test("does not open under a different BETTER_AUTH_SECRET", () => {
		const sealed = sealSecret("sk-or-v1-abc");
		const original = process.env.BETTER_AUTH_SECRET;
		process.env.BETTER_AUTH_SECRET = "a-different-secret";
		try {
			expect(() => openSecret(sealed)).toThrow(/auth/i);
		} finally {
			process.env.BETTER_AUTH_SECRET = original;
		}
		expect(openSecret(sealed)).toBe("sk-or-v1-abc");
	});
});

describe("openAndHeal", () => {
	test("reseals a legacy plaintext value and returns the plaintext", async () => {
		const written: string[] = [];
		const plaintext = await openAndHeal(
			"sk-or-v1-legacy",
			async (sealed) => {
				written.push(sealed);
			},
			"a test key",
		);
		expect(plaintext).toBe("sk-or-v1-legacy");
		expect(written).toHaveLength(1);
		expect(openSecret(written[0] ?? "")).toBe("sk-or-v1-legacy");
	});

	test("leaves a sealed value alone", async () => {
		const written: string[] = [];
		const plaintext = await openAndHeal(
			sealSecret("sk-or-v1-new"),
			async (sealed) => {
				written.push(sealed);
			},
			"a test key",
		);
		expect(plaintext).toBe("sk-or-v1-new");
		expect(written).toHaveLength(0);
	});

	test("answers null for a value that does not decrypt", async () => {
		expect(
			await openAndHeal("enc:v1:c2hvcnQ", async () => {}, "a test key"),
		).toBeNull();
	});

	test("logs an unreadable value one time", async () => {
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			for (let i = 0; i < 3; i++) {
				await openAndHeal("enc:v1:b25jZQ", async () => {}, "a test key");
			}
			expect(logged).toHaveBeenCalledTimes(1);
		} finally {
			logged.mockRestore();
		}
	});

	test("still answers when the reseal fails", async () => {
		expect(
			await openAndHeal(
				"sk-or-v1-legacy",
				async () => {
					throw new Error("database is down");
				},
				"a test key",
			),
		).toBe("sk-or-v1-legacy");
	});
});
