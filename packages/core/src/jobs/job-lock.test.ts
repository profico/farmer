import { describe, expect, test } from "bun:test";

import { type TryJobLock, withJobLock } from "./job-lock";

const lockSpy = (available: boolean) => {
	const events: string[] = [];
	const tryLock: TryJobLock = async (name) => {
		events.push(`try ${name}`);
		if (!available) return null;
		return async () => {
			events.push(`release ${name}`);
		};
	};
	return { events, tryLock };
};

describe("withJobLock", () => {
	test("runs the job and releases the lock", async () => {
		const { events, tryLock } = lockSpy(true);
		const result = await withJobLock(
			"Job A",
			async () => {
				events.push("run");
				return 7;
			},
			tryLock,
		);
		expect(result).toEqual({ ran: true, value: 7 });
		expect(events).toEqual(["try Job A", "run", "release Job A"]);
	});

	test("skips the job when another instance holds the lock", async () => {
		const { events, tryLock } = lockSpy(false);
		const result = await withJobLock(
			"Job A",
			async () => {
				events.push("run");
			},
			tryLock,
		);
		expect(result).toEqual({ ran: false });
		expect(events).toEqual(["try Job A"]);
	});

	test("releases the lock when the job throws", async () => {
		const { events, tryLock } = lockSpy(true);
		await expect(
			withJobLock(
				"Job A",
				async () => {
					throw new Error("boom");
				},
				tryLock,
			),
		).rejects.toThrow("boom");
		expect(events).toEqual(["try Job A", "release Job A"]);
	});
});
