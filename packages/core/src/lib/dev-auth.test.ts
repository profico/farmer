import { afterEach, describe, expect, test } from "bun:test";

import { isDevAuthEnabled } from "./dev-auth";

const original = process.env.NODE_ENV;

afterEach(() => {
	process.env.NODE_ENV = original;
});

const withNodeEnv = (value: string | undefined) => {
	if (value === undefined) delete process.env.NODE_ENV;
	else process.env.NODE_ENV = value;
	return isDevAuthEnabled();
};

describe("isDevAuthEnabled", () => {
	test("is on under vite dev and bun test", () => {
		expect(withNodeEnv("development")).toBe(true);
		expect(withNodeEnv("test")).toBe(true);
	});

	test("fails closed on production, an unknown value and an unset NODE_ENV", () => {
		expect(withNodeEnv("production")).toBe(false);
		expect(withNodeEnv("staging")).toBe(false);
		expect(withNodeEnv("")).toBe(false);
		expect(withNodeEnv(undefined)).toBe(false);
	});
});
