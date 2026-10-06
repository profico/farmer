/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { DAY_PARAM, isDayKey, timeDayRoute } from "./day-link";

describe("the link to a day of the Time tab", () => {
	test("accepts a real day and refuses the rest", () => {
		expect(isDayKey("2026-10-06")).toBe(true);
		expect(isDayKey("2024-02-29")).toBe(true);
		expect(isDayKey("2026-02-30")).toBe(false);
		expect(isDayKey("2026-13-01")).toBe(false);
		expect(isDayKey("6 Oct")).toBe(false);
		expect(isDayKey("")).toBe(false);
		expect(isDayKey(undefined)).toBe(false);
	});

	test("puts the day in the param that the Time tab reads", () => {
		expect(timeDayRoute("2026-10-06")).toEqual({
			pathname: "/",
			params: { [DAY_PARAM]: "2026-10-06" },
		});
	});
});
