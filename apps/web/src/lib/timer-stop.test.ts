import { describe, expect, test } from "bun:test";

import { stopPayloadFields } from "./timer-stop";

const filled = { projectId: "p1", description: "Old note" };

describe("stopPayloadFields", () => {
	test("leaves out a field the person did not edit on a continued entry", () => {
		expect(
			stopPayloadFields({ continuing: true, form: filled, filled }),
		).toEqual({});
	});

	test("sends a field the person edited", () => {
		expect(
			stopPayloadFields({
				continuing: true,
				form: { projectId: "p2", description: " New note " },
				filled,
			}),
		).toEqual({ projectId: "p2", description: "New note" });
	});

	test("sends an emptied note", () => {
		expect(
			stopPayloadFields({
				continuing: true,
				form: { ...filled, description: "" },
				filled,
			}),
		).toEqual({ description: "" });
	});

	test("always sends both fields for a timer without an entry", () => {
		expect(
			stopPayloadFields({ continuing: false, form: filled, filled }),
		).toEqual({ projectId: "p1", description: "Old note" });
	});
});
