import { describe, expect, test } from "bun:test";

import { groupedCorners, RADIUS, CORNER, cornerFor } from "./corner";

describe("cornerFor", () => {
	test("Android takes the Material 3 radius", () => {
		expect(cornerFor("card", "android")).toBe(CORNER.medium);
		expect(cornerFor("dialog", "android")).toBe(28);
	});

	test("iOS keeps its own number where the module has one", () => {
		expect(cornerFor("card", "ios")).toBe(12);
		expect(cornerFor("field", "ios")).toBe(10);
	});
});

describe("groupedCorners", () => {
	test("the outer corners are large and the inner corners are small", () => {
		const first = groupedCorners(0, 3);
		const middle = groupedCorners(1, 3);
		const last = groupedCorners(2, 3);
		expect(first.borderTopLeftRadius).toBe(RADIUS.listGroup);
		expect(first.borderBottomLeftRadius).toBe(RADIUS.listInner);
		expect(middle.borderTopLeftRadius).toBe(RADIUS.listInner);
		expect(last.borderBottomRightRadius).toBe(RADIUS.listGroup);
	});

	test("one row has four large corners", () => {
		const only = groupedCorners(0, 1);
		expect(only.borderTopLeftRadius).toBe(RADIUS.listGroup);
		expect(only.borderBottomRightRadius).toBe(RADIUS.listGroup);
	});
});
