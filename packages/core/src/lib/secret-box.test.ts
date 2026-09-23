import { describe, expect, spyOn, test } from "bun:test";

import {
	isSealed,
	isSealedWithCurrentKey,
	openAndHeal,
	openSecret,
	sealSecret,
} from "./secret-box";

/** Run `body` with BETTER_AUTH_SECRETS set to `value` (or removed, for
 *  undefined), and put the old value back after it. */
const withRotation = async (
	value: string | undefined,
	body: () => void | Promise<void>,
) => {
	const original = process.env.BETTER_AUTH_SECRETS;
	if (value === undefined) delete process.env.BETTER_AUTH_SECRETS;
	else process.env.BETTER_AUTH_SECRETS = value;
	try {
		await body();
	} finally {
		if (original === undefined) delete process.env.BETTER_AUTH_SECRETS;
		else process.env.BETTER_AUTH_SECRETS = original;
	}
};

const OLD = "1:the-first-secret-in-the-rotation-set";
const NEW = "2:the-second-secret-in-the-rotation-set";

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

describe("rotation through BETTER_AUTH_SECRETS", () => {
	test("without it, seals as enc:v1 under BETTER_AUTH_SECRET", async () => {
		await withRotation(undefined, () => {
			const sealed = sealSecret("sk-or-v1-abc");
			expect(sealed.startsWith("enc:v1:")).toBe(true);
			expect(isSealedWithCurrentKey(sealed)).toBe(true);
			expect(openSecret(sealed)).toBe("sk-or-v1-abc");
		});
	});

	test("seals with the first (current) version", async () => {
		await withRotation(`${NEW},${OLD}`, () => {
			const sealed = sealSecret("sk-or-v1-abc");
			expect(sealed.startsWith("enc:v2:2:")).toBe(true);
			expect(isSealed(sealed)).toBe(true);
			expect(isSealedWithCurrentKey(sealed)).toBe(true);
			expect(openSecret(sealed)).toBe("sk-or-v1-abc");
		});
	});

	test("still opens a legacy enc:v1 value with BETTER_AUTH_SECRET", async () => {
		const legacy = sealSecret("sk-or-v1-legacy");
		await withRotation(`${NEW},${OLD}`, () => {
			expect(isSealedWithCurrentKey(legacy)).toBe(false);
			expect(openSecret(legacy)).toBe("sk-or-v1-legacy");
		});
	});

	test("opens an older version by direct lookup", async () => {
		let old = "";
		await withRotation(OLD, () => {
			old = sealSecret("xoxb-old");
		});
		expect(old.startsWith("enc:v2:1:")).toBe(true);
		await withRotation(`${NEW},${OLD}`, () => {
			expect(isSealedWithCurrentKey(old)).toBe(false);
			expect(openSecret(old)).toBe("xoxb-old");
		});
	});

	test("the first entry is current, whatever its number", async () => {
		await withRotation(`${OLD},${NEW}`, () => {
			expect(sealSecret("x").startsWith("enc:v2:1:")).toBe(true);
		});
	});

	test("refuses a version the list no longer holds", async () => {
		let old = "";
		await withRotation(OLD, () => {
			old = sealSecret("xoxb-old");
		});
		await withRotation(NEW, () => {
			expect(() => openSecret(old)).toThrow(/version 1 not found/);
		});
		await withRotation(undefined, () => {
			expect(() => openSecret(old)).toThrow(/version 1 not found/);
		});
		expect(() => openSecret("enc:v2:nope")).toThrow(/no key version/);
	});

	test("refuses a malformed BETTER_AUTH_SECRETS, as better-auth does", async () => {
		await withRotation("no-version-here", () => {
			expect(() => sealSecret("x")).toThrow(/Invalid BETTER_AUTH_SECRETS/);
		});
		await withRotation("1:a,1:b", () => {
			expect(() => sealSecret("x")).toThrow(/Duplicate version 1/);
		});
	});

	test("openAndHeal reseals an old version under the current one", async () => {
		let old = "";
		await withRotation(OLD, () => {
			old = sealSecret("xoxb-old");
		});
		const legacy = sealSecret("sk-or-v1-legacy");
		await withRotation(`${NEW},${OLD}`, async () => {
			for (const [stored, plaintext] of [
				[old, "xoxb-old"],
				[legacy, "sk-or-v1-legacy"],
			] as const) {
				const written: string[] = [];
				expect(
					await openAndHeal(
						stored,
						async (sealed) => {
							written.push(sealed);
						},
						"a test key",
					),
				).toBe(plaintext);
				expect(written).toHaveLength(1);
				const resealed = written[0] ?? "";
				expect(resealed.startsWith("enc:v2:2:")).toBe(true);
				expect(openSecret(resealed)).toBe(plaintext);
			}
		});
	});

	test("openAndHeal leaves a value under the current version alone", async () => {
		await withRotation(`${NEW},${OLD}`, async () => {
			let calls = 0;
			await openAndHeal(
				sealSecret("xoxb-new"),
				async () => {
					calls++;
				},
				"a test key",
			);
			expect(calls).toBe(0);
		});
	});
});
