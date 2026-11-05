/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { headStartError, headStartLimit, stepHeadStart } from "./head-start";

const H = 3600;

describe("a head start", () => {
	test("must be shorter than the limit, and shorter than a day", () => {
		expect(headStartLimit(undefined)).toBe(24 * H);
		expect(headStartLimit(48 * H)).toBe(24 * H);
		expect(headStartLimit(12 * H)).toBe(12 * H);
		expect(headStartError(0, 12 * H)).toBeNull();
		expect(headStartError(11 * H, 12 * H)).toBeNull();
		expect(headStartError(12 * H, 12 * H)).toBe(
			"A head start must be shorter than your timer limit of 12:00.",
		);
		expect(headStartError(24 * H, 24 * H)).toBe(
			"A head start must be shorter than a day.",
		);
	});

	test("steps by five minutes and stops under the limit", () => {
		expect(stepHeadStart(0, 1, H)).toBe(300);
		expect(stepHeadStart(300, -2, H)).toBe(0);
		expect(stepHeadStart(H - 300, 1, H)).toBe(H - 300);
		expect(headStartError(stepHeadStart(0, 1000, 1000), 1000)).toBeNull();
	});
});
