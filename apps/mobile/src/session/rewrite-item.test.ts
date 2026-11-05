/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { rewriteItem } from "./rewrite-item";

const fake = (value: string | null, failures: { write?: number } = {}) => {
	const calls: string[] = [];
	let writeFailures = failures.write ?? 0;
	return {
		calls,
		item: {
			read: async () => {
				calls.push("read");
				return value;
			},
			remove: async () => {
				calls.push("remove");
			},
			write: async (written: string) => {
				calls.push(`write:${written}`);
				if (writeFailures > 0) {
					writeFailures -= 1;
					throw new Error("keychain busy");
				}
			},
		},
	};
};

describe("rewriteItem", () => {
	test("deletes the item and writes the same value at once", async () => {
		const { calls, item } = fake("secret");
		expect(await rewriteItem(item)).toBe(true);
		expect(calls).toEqual(["read", "remove", "write:secret"]);
	});

	test("an absent item is done, with no write", async () => {
		const { calls, item } = fake(null);
		expect(await rewriteItem(item)).toBe(true);
		expect(calls).toEqual(["read"]);
	});

	test("a failed write is tried once more", async () => {
		const { calls, item } = fake("secret", { write: 1 });
		expect(await rewriteItem(item)).toBe(true);
		expect(calls).toEqual(["read", "remove", "write:secret", "write:secret"]);
	});

	test("two failed writes report failure", async () => {
		const { item } = fake("secret", { write: 2 });
		expect(await rewriteItem(item)).toBe(false);
	});

	test("a failed read or delete reports failure and writes nothing", async () => {
		const { calls, item } = fake("secret");
		expect(
			await rewriteItem({
				...item,
				read: async () => {
					throw new Error("locked");
				},
			}),
		).toBe(false);
		expect(
			await rewriteItem({
				...item,
				remove: async () => {
					throw new Error("locked");
				},
			}),
		).toBe(false);
		expect(calls.some((call) => call.startsWith("write"))).toBe(false);
	});
});
