import { afterEach, expect, test } from "bun:test";

import { readServerVersion } from "./deployment-info";

const before = process.env.SERVER_VERSION;

afterEach(() => {
	if (before === undefined) delete process.env.SERVER_VERSION;
	else process.env.SERVER_VERSION = before;
});

test.each([
	["v1.2.3", "1.2.3"],
	["1.2.3-rc.1", "1.2.3-rc.1"],
	["main", null],
	["", null],
])("SERVER_VERSION=%p reads as %p", (value, expected) => {
	process.env.SERVER_VERSION = value;
	expect(readServerVersion()).toBe(expected);
});

test("an unset SERVER_VERSION reads as null", () => {
	delete process.env.SERVER_VERSION;
	expect(readServerVersion()).toBeNull();
});
