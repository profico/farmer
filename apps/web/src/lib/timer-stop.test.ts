import { describe, expect, test } from "bun:test";

import { stopPayloadFields } from "./timer-stop";

const filled = {
	duration: "1:00",
	date: "2026-08-10",
	projectId: "p1",
	taskId: "t1",
	description: "Old note",
};

describe("stopPayloadFields", () => {
	test("leaves out every field the person did not edit", () => {
		expect(stopPayloadFields({ form: filled, filled, seconds: 3600 })).toEqual(
			{},
		);
	});

	test("sends a field the person edited", () => {
		expect(
			stopPayloadFields({
				form: {
					...filled,
					projectId: "p2",
					description: " New note ",
					duration: "1:30",
				},
				filled,
				seconds: 5400,
			}),
		).toEqual({
			projectId: "p2",
			description: "New note",
			durationSeconds: 5400,
		});
	});

	test("sends an emptied note and a cleared project", () => {
		expect(
			stopPayloadFields({
				form: { ...filled, description: "", projectId: null },
				filled,
				seconds: 3600,
			}),
		).toEqual({ description: "", projectId: null });
	});

	test("sends the date and the task when edited", () => {
		expect(
			stopPayloadFields({
				form: { ...filled, date: "2026-08-09", taskId: "t2" },
				filled,
				seconds: 3600,
			}),
		).toEqual({ date: "2026-08-09", taskId: "t2" });
	});

	test("sends every field before the form was filled", () => {
		expect(
			stopPayloadFields({ form: filled, filled: null, seconds: 3600 }),
		).toEqual({
			date: "2026-08-10",
			projectId: "p1",
			taskId: "t1",
			description: "Old note",
			durationSeconds: 3600,
		});
	});
});
