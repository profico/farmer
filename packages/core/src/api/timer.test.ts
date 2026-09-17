// The projection, in the shape `time-entries.test.ts` sets: hand it a row with
// more than it asked for and check that the extra fields do not come out the
// other side. A timer row carries the workspace id and the person's id, and
// neither belongs in an answer a CLI binary will parse.

import { describe, expect, test } from "bun:test";

import { toApiTimer } from "./timer";

const startedAt = new Date("2026-09-17T08:00:00Z");
const serverNow = new Date("2026-09-17T09:12:00Z");

/** A row shaped like `timersService.get`'s, plus the bookkeeping it holds. */
const fullRow = () => ({
	id: "tm-1",
	organizationId: "org-1",
	organizationSlug: "acme",
	organizationName: "Acme",
	userId: "u-1",
	here: true,
	projectId: "p-1",
	projectName: "Portal",
	taskId: "t-1",
	taskName: "Development",
	description: "Fix login",
	startedAt,
	droppedAt: null,
	createdAt: startedAt,
	updatedAt: startedAt,
	elapsedSeconds: 4320,
	snappedSeconds: 4500,
	serverNow,
});

describe("toApiTimer", () => {
	test("keeps exactly the fields it names, at every level", () => {
		expect(toApiTimer(fullRow())).toStrictEqual({
			id: "tm-1",
			startedAt: "2026-09-17T08:00:00.000Z",
			droppedAt: null,
			elapsedSeconds: 4320,
			snappedSeconds: 4500,
			serverNow: "2026-09-17T09:12:00.000Z",
			description: "Fix login",
			task: { id: "t-1", name: "Development" },
			project: { id: "p-1", name: "Portal" },
			organization: { slug: "acme", name: "Acme", here: true },
		});
	});

	test("drops the row's identifiers and bookkeeping", () => {
		const projected = toApiTimer(fullRow());
		for (const key of [
			"organizationId",
			"userId",
			"createdAt",
			"updatedAt",
			"taskId",
			"projectId",
			"here",
		]) {
			expect(Object.keys(projected)).not.toContain(key);
		}
	});

	// A timer with no project is the unfiled case: it measures against a task
	// alone and the entry is filed later.
	test("reads a timer with no project", () => {
		const projected = toApiTimer({
			...fullRow(),
			projectId: null,
			projectName: null,
		});
		expect(projected.project).toBe(null);
	});

	// A dropped timer logged nothing. The client shows the notice, so the
	// instant it stopped measuring has to survive the projection.
	test("carries the instant a dropped timer stopped", () => {
		const droppedAt = new Date("2026-09-17T20:00:00Z");
		const projected = toApiTimer({ ...fullRow(), droppedAt });
		expect(projected.droppedAt).toBe("2026-09-17T20:00:00.000Z");
	});

	// The timer is the person's, not the workspace's: a read from another
	// workspace still answers, and `here` is how a client knows to say where it
	// is running instead of offering a Stop button that would leave the page.
	test("says when the timer belongs to another workspace", () => {
		const projected = toApiTimer({
			...fullRow(),
			here: false,
			organizationSlug: "beta",
			organizationName: "Beta",
		});
		expect(projected.organization).toStrictEqual({
			slug: "beta",
			name: "Beta",
			here: false,
		});
	});
});
