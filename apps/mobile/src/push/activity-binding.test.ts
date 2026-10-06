import { describe, expect, test } from "bun:test";

import { activityBinding } from "./activity-binding";

describe("activityBinding", () => {
	test("binds a new token on iOS", () => {
		expect(activityBinding("ios", "abc", null)).toEqual({
			liveActivityToken: "abc",
		});
	});

	test("binds a changed token", () => {
		expect(activityBinding("ios", "def", "abc")).toEqual({
			liveActivityToken: "def",
		});
	});

	test("sends null when the activity ended and the relay holds a token", () => {
		expect(activityBinding("ios", null, "abc")).toEqual({
			liveActivityToken: null,
		});
	});

	test("sends nothing when the relay already holds the token", () => {
		expect(activityBinding("ios", "abc", "abc")).toBeNull();
	});

	test("sends nothing to unbind when nothing is bound", () => {
		expect(activityBinding("ios", null, null)).toBeNull();
		expect(activityBinding("ios", null, undefined)).toBeNull();
	});

	test("sends nothing before the app learned a token", () => {
		expect(activityBinding("ios", undefined, "abc")).toBeNull();
	});

	test("force binds a running token that the relay already holds", () => {
		expect(activityBinding("ios", "abc", "abc", true)).toEqual({
			liveActivityToken: "abc",
		});
	});

	test("force sends nothing when no activity runs", () => {
		expect(activityBinding("ios", null, null, true)).toBeNull();
		expect(activityBinding("ios", null, "abc", true)).toEqual({
			liveActivityToken: null,
		});
		expect(activityBinding("ios", undefined, "abc", true)).toBeNull();
	});

	test("never sends on Android", () => {
		expect(activityBinding("android", "abc", null)).toBeNull();
		expect(activityBinding("android", null, "abc")).toBeNull();
	});
});
