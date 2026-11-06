import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { checkRequiredEnv, requireProductionEnv } from "./required-env";

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

describe("requireProductionEnv", () => {
	const exit = spyOn(process, "exit").mockImplementation(() => {
		throw new Error("exit");
	});
	afterEach(() => exit.mockClear());

	const run = (env: Record<string, string>) => {
		const lines: string[] = [];
		const sink = { error: (l: string) => lines.push(l), warn: () => {} };
		try {
			requireProductionEnv(sink, env);
		} catch {
			// The stubbed process.exit throws, so the call does not go on.
		}
		return lines;
	};

	test("does nothing outside production", () => {
		expect(run({ NODE_ENV: "development" })).toEqual([]);
		expect(exit).not.toHaveBeenCalled();
	});

	test("prints one message and exits 1 in production", () => {
		const lines = run({ NODE_ENV: "production" });
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain(
			"DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL",
		);
		expect(exit).toHaveBeenCalledWith(1);
	});

	test("does not exit when the environment is complete", () => {
		expect(run({ ...good, NODE_ENV: "production" })).toEqual([]);
		expect(exit).not.toHaveBeenCalled();
	});
});
