/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { minTargetFor, verticalSlop } from "./touch-target";

describe("minTargetFor", () => {
	test("48 on Android, 44 on iOS", () => {
		expect(minTargetFor("android")).toBe(48);
		expect(minTargetFor("ios")).toBe(44);
	});
});

describe("verticalSlop", () => {
	test("grows a 40 control to 48 on Android and 44 on iOS", () => {
		expect(verticalSlop(40)).toEqual({ top: 4, bottom: 4 });
		expect(verticalSlop(40, minTargetFor("ios"))).toEqual({
			top: 2,
			bottom: 2,
		});
	});

	test("adds nothing to a control that is large enough", () => {
		expect(verticalSlop(56)).toEqual({ top: 0, bottom: 0 });
	});
});
