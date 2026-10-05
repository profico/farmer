/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { skipReasonLabel, spanError, withFirstDay } from "./time-off";

describe("the range of time off", () => {
	test("one day and 62 days are both a range", () => {
		expect(spanError("2026-10-06", "2026-10-06")).toBeNull();
		expect(spanError("2026-10-06", "2026-12-07")).toBeNull();
	});

	test("a backwards range and a range over 62 days are refused", () => {
		expect(spanError("2026-10-06", "2026-10-05")).toBe(
			"The last day is before the first day.",
		);
		expect(spanError("2026-10-06", "2026-12-08")).toContain("62 days");
	});

	test("a first day after the last day moves the last day", () => {
		expect(
			withFirstDay({ from: "2026-10-06", to: "2026-10-08" }, "2026-10-10"),
		).toEqual({ from: "2026-10-10", to: "2026-10-10" });
		expect(
			withFirstDay({ from: "2026-10-06", to: "2026-10-08" }, "2026-10-07"),
		).toEqual({ from: "2026-10-07", to: "2026-10-08" });
	});

	test("a skipped day says why in the person's words", () => {
		expect(skipReasonLabel("public holiday")).toBe("Public holiday");
		expect(skipReasonLabel("not a working day for this person")).toBe(
			"Not a working day for you",
		);
		expect(skipReasonLabel("a new reason")).toBe("a new reason");
	});
});
