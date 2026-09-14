import { afterEach, describe, expect, test } from "bun:test";

import { isCliEnabled } from "./cli-flag";

const original = process.env.CLI_ENABLED;

afterEach(() => {
	if (original === undefined) delete process.env.CLI_ENABLED;
	else process.env.CLI_ENABLED = original;
});

describe("isCliEnabled", () => {
	// Default on: a deployment that never heard of the variable runs the CLI.
	test("is on when the variable is unset", () => {
		delete process.env.CLI_ENABLED;
		expect(isCliEnabled()).toBe(true);
	});

	test("is off only for the exact string false", () => {
		process.env.CLI_ENABLED = "false";
		expect(isCliEnabled()).toBe(false);
	});

	// Anything but "true" is off once the variable is set, the same rule as
	// `MCP_ENABLED`: a typo turns the surface off rather than silently on.
	test("is off for any other value", () => {
		for (const value of ["0", "no", "TRUE", ""]) {
			process.env.CLI_ENABLED = value;
			expect(isCliEnabled()).toBe(false);
		}
		process.env.CLI_ENABLED = "true";
		expect(isCliEnabled()).toBe(true);
	});

	// Read per call, not captured at import: the tests above depend on it, and
	// so does an operator who restarts with a changed environment.
	test("reads the environment on every call", () => {
		process.env.CLI_ENABLED = "false";
		expect(isCliEnabled()).toBe(false);
		process.env.CLI_ENABLED = "true";
		expect(isCliEnabled()).toBe(true);
	});
});
