import { describe, expect, test } from "bun:test";

import { checkRequiredEnv } from "./required-env";

const good = {
	DATABASE_URL: "postgres://farmer:pw@db:5432/farmer",
	BETTER_AUTH_SECRET: "a".repeat(64),
	BETTER_AUTH_URL: "https://farmer.example.com",
};

describe("checkRequiredEnv", () => {
	test("accepts a complete environment with no warning", () => {
		expect(checkRequiredEnv(good)).toEqual({ missing: [], warnings: [] });
	});

	test("names every missing or empty variable", () => {
		const { missing } = checkRequiredEnv({ BETTER_AUTH_SECRET: " " });
		expect(missing).toEqual([
			"DATABASE_URL",
			"BETTER_AUTH_SECRET",
			"BETTER_AUTH_URL",
		]);
	});

	test("warns, and does not fail, on a weak value", () => {
		const result = checkRequiredEnv({
			...good,
			BETTER_AUTH_SECRET: "short",
			BETTER_AUTH_URL: "not a url",
		});
		expect(result.missing).toEqual([]);
		expect(result.warnings).toHaveLength(2);
	});
});
