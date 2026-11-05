/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { noteMissing, noteRequired, noteStateOf } from "./entry-form";

const worked = {
	hasTask: true,
	absence: false,
	systemKey: null,
	isFill: false,
};

describe("noteRequired", () => {
	test("worked time needs a note", () => {
		expect(noteRequired(worked)).toBe(true);
		expect(noteRequired({ ...worked, systemKey: "meeting" })).toBe(true);
	});

	test("time off, a break and a rest-of-day block need none", () => {
		expect(noteRequired({ ...worked, absence: true })).toBe(false);
		expect(noteRequired({ ...worked, systemKey: "break" })).toBe(false);
		expect(noteRequired({ ...worked, isFill: true })).toBe(false);
	});

	test("with no task picked, nothing is required yet", () => {
		expect(noteRequired({ ...worked, hasTask: false })).toBe(false);
	});
});

describe("noteMissing", () => {
	test("a blank note is missing when a note is required", () => {
		expect(noteMissing(true, "")).toBe(true);
		expect(noteMissing(true, "  \n ")).toBe(true);
		expect(noteMissing(true, "Fixed the build")).toBe(false);
	});

	test("a blank note is fine when none is required", () => {
		expect(noteMissing(false, "")).toBe(false);
	});
});

describe("noteStateOf", () => {
	const input = {
		taskId: "t1",
		absence: false,
		task: { systemKey: null },
		isFill: false,
		note: "",
	};

	test("blocks an empty note on worked time", () => {
		expect(noteStateOf(input)).toEqual({ required: true, missing: true });
		expect(noteStateOf({ ...input, note: "Done" })).toEqual({
			required: true,
			missing: false,
		});
	});

	test("does not block time off", () => {
		expect(noteStateOf({ ...input, absence: true })).toEqual({
			required: false,
			missing: false,
		});
	});
});
