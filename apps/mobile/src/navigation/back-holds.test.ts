import { describe, expect, test } from "bun:test";

import { holdBack, holdCount, systemMayHandleBack } from "./back-holds";

describe("systemMayHandleBack", () => {
	test("is true only with nothing to go back to and no hold", () => {
		expect(systemMayHandleBack(false, 0)).toBe(true);
		expect(systemMayHandleBack(true, 0)).toBe(false);
		expect(systemMayHandleBack(false, 1)).toBe(false);
	});
});

describe("holdBack", () => {
	test("releases a hold only once", () => {
		const release = holdBack();
		expect(holdCount()).toBe(1);
		release();
		release();
		expect(holdCount()).toBe(0);
	});
});
