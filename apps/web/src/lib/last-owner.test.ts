/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { isLastActiveOwner } from "./last-owner.ts";

describe("isLastActiveOwner", () => {
	const a = { userId: "a" };
	const b = { userId: "b" };

	test("the only active owner is the last one", () => {
		expect(isLastActiveOwner(a, [a])).toBe(true);
	});

	test("an archived owner is not the last one while another owner is active", () => {
		expect(isLastActiveOwner(b, [a])).toBe(false);
	});

	test("a member with two active owners is not the last one", () => {
		expect(isLastActiveOwner(a, [a, b])).toBe(false);
	});

	test("a non-owner is never the last one", () => {
		expect(isLastActiveOwner({ userId: "c" }, [])).toBe(false);
	});
});
