import { describe, expect, test } from "bun:test";

import {
	type ImportKeyFields,
	hashImportKeyFields,
	importRowKey,
	keysForPersonDay,
	personDayKey,
} from "./keys";

function fields(overrides: Partial<ImportKeyFields> = {}): ImportKeyFields {
	return {
		date: "2024-01-02",
		firstName: "Probo",
		lastName: "Testić",
		client: "Profico",
		project: "Internal",
		projectCode: "PRINT",
		task: "Admin",
		notes: "",
		hours: "1,5",
		...overrides,
	};
}

describe("personDayKey", () => {
	test("is stable across calls", () => {
		const a = personDayKey("2024-01-02", "Probo", "Testić");
		const b = personDayKey("2024-01-02", "Probo", "Testić");
		expect(a).toBe(b);
	});

	test("differs by date, first name or last name", () => {
		const base = personDayKey("2024-01-02", "Probo", "Testić");
		expect(personDayKey("2024-01-03", "Probo", "Testić")).not.toBe(base);
		expect(personDayKey("2024-01-02", "Marina", "Testić")).not.toBe(base);
		expect(personDayKey("2024-01-02", "Probo", "Meštrović")).not.toBe(base);
	});
});

describe("hashImportKeyFields", () => {
	test("is stable across calls", async () => {
		const a = await hashImportKeyFields(fields());
		const b = await hashImportKeyFields(fields());
		expect(a).toBe(b);
	});

	test("different notes produce different hashes", async () => {
		const a = await hashImportKeyFields(fields({ notes: "one" }));
		const b = await hashImportKeyFields(fields({ notes: "two" }));
		expect(a).not.toBe(b);
	});

	test("different hours produce different hashes", async () => {
		const a = await hashImportKeyFields(fields({ hours: "1,5" }));
		const b = await hashImportKeyFields(fields({ hours: "2,5" }));
		expect(a).not.toBe(b);
	});

	test("looks like a hex sha256 digest", async () => {
		const hash = await hashImportKeyFields(fields());
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe("importRowKey", () => {
	test("appends the counter", async () => {
		expect(await importRowKey(fields(), 0)).toMatch(/:0$/);
		expect(await importRowKey(fields(), 3)).toMatch(/:3$/);
	});

	test("the hash half matches hashImportKeyFields", async () => {
		const key = await importRowKey(fields(), 0);
		const hash = await hashImportKeyFields(fields());
		expect(key).toBe(`${hash}:0`);
	});
});

describe("keysForPersonDay", () => {
	test("distinct rows each get counter 0", async () => {
		const keys = await keysForPersonDay([
			fields({ notes: "a" }),
			fields({ notes: "b" }),
		]);
		expect(keys[0]).toMatch(/:0$/);
		expect(keys[1]).toMatch(/:0$/);
		expect(keys[0]).not.toBe(keys[1]);
	});

	test("identical rows get 0, 1, 2 in file order", async () => {
		const keys = await keysForPersonDay([fields(), fields(), fields()]);
		expect(keys[0]?.endsWith(":0")).toBe(true);
		expect(keys[1]?.endsWith(":1")).toBe(true);
		expect(keys[2]?.endsWith(":2")).toBe(true);
		// Same hash half for all three.
		const hashOf = (key: string | undefined) => key?.split(":")[0];
		expect(hashOf(keys[0])).toBe(hashOf(keys[1]));
		expect(hashOf(keys[1])).toBe(hashOf(keys[2]));
	});

	test("a mix of identical and distinct rows counts independently per hash", async () => {
		const rows = [
			fields({ notes: "a" }),
			fields({ notes: "a" }),
			fields({ notes: "b" }),
			fields({ notes: "a" }),
		];
		const keys = await keysForPersonDay(rows);
		expect(keys).toEqual([
			`${keys[0]?.split(":")[0]}:0`,
			`${keys[1]?.split(":")[0]}:1`,
			`${keys[2]?.split(":")[0]}:0`,
			`${keys[3]?.split(":")[0]}:2`,
		]);
	});

	test("keys are stable across separate calls with the same input", async () => {
		const rows = [fields({ notes: "a" }), fields({ notes: "a" })];
		const first = await keysForPersonDay(rows);
		const second = await keysForPersonDay(rows);
		expect(first).toEqual(second);
	});

	test("an empty list of rows yields an empty list of keys", async () => {
		expect(await keysForPersonDay([])).toEqual([]);
	});
});
