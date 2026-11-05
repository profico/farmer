import { afterEach, describe, expect, spyOn, test } from "bun:test";

import {
	JOB_FAILURE_BUDGET,
	type JobFailure,
	reportJobFailure,
	setJobFailureSink,
	withJobFailureBudget,
} from "./job-failures";

afterEach(() => setJobFailureSink(null));

describe("reportJobFailure", () => {
	test("does nothing until a sink is installed", () => {
		expect(() =>
			reportJobFailure({ job: "timer-sweep", error: new Error("x") }),
		).not.toThrow();
	});

	test("hands the job and the error to the sink", () => {
		const reports: JobFailure[] = [];
		setJobFailureSink((failure) => reports.push(failure));
		const error = new Error("boom");
		reportJobFailure({ job: "timer-sweep", error, organizationId: "org-1" });
		expect(reports).toEqual([
			{ job: "timer-sweep", error, organizationId: "org-1" },
		]);
	});

	test("a tick sends at most the budget, and the next tick starts fresh", async () => {
		let count = 0;
		setJobFailureSink(() => count++);
		const tick = () =>
			withJobFailureBudget(async () => {
				for (let i = 0; i < JOB_FAILURE_BUDGET + 5; i++) {
					reportJobFailure({ job: "log-reminders", error: new Error("x") });
				}
			});
		await tick();
		expect(count).toBe(JOB_FAILURE_BUDGET);
		await tick();
		expect(count).toBe(JOB_FAILURE_BUDGET * 2);
	});

	test("the budget holds across Promise.all workers and a timer", async () => {
		let count = 0;
		setJobFailureSink(() => count++);
		const report = () =>
			reportJobFailure({ job: "log-reminders", error: new Error("x") });
		await withJobFailureBudget(async () => {
			await Promise.all(
				Array.from({ length: 4 }, async () => {
					for (let i = 0; i < JOB_FAILURE_BUDGET; i++) report();
				}),
			);
			await new Promise((resolve) => setTimeout(resolve, 5));
			report();
		});
		expect(count).toBe(JOB_FAILURE_BUDGET);
	});

	test("a sink that throws does not break the caller", () => {
		const log = spyOn(console, "error").mockImplementation(() => {});
		setJobFailureSink(() => {
			throw new Error("sink down");
		});
		try {
			expect(() =>
				reportJobFailure({ job: "timer-sweep", error: new Error("x") }),
			).not.toThrow();
			expect(log).toHaveBeenCalledTimes(1);
		} finally {
			log.mockRestore();
		}
	});
});
