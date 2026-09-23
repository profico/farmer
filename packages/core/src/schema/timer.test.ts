import { describe, expect, test } from "bun:test";

import { MAX_DAY_SECONDS } from "../lib/time";
import { confirmTimerInput, startTimerInput } from "./timer";

const TASK_ID = "7c1a6f0e-3b0a-4c61-9d2e-5b1f8c0a9e11";

describe("startTimerInput", () => {
	// The same bound `parseHeadStart` reads in both clients: shorter than a
	// day. The schema once allowed exactly a day, which both clients refused.
	test("refuses a head start of a day", () => {
		const input = { taskId: TASK_ID, headStartSeconds: MAX_DAY_SECONDS };

		expect(startTimerInput.safeParse(input).success).toBe(false);
		expect(
			startTimerInput.safeParse({
				...input,
				headStartSeconds: MAX_DAY_SECONDS - 1,
			}).success,
		).toBe(true);
	});
});

describe("confirmTimerInput", () => {
	const body = { date: "2026-08-11", taskId: TASK_ID, durationSeconds: 900 };

	// Null is how a caller clears the project of an entry it continues; an
	// absent one keeps the entry's.
	test("tells a null project from an absent one", () => {
		const absent = confirmTimerInput.parse(body);
		const cleared = confirmTimerInput.parse({ ...body, projectId: null });

		expect(absent.projectId).toBeUndefined();
		expect(cleared.projectId).toBeNull();
	});
});
