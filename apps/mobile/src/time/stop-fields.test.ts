/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import type { Timer } from "@farmer/api-client";

import { stopFormFields, stopPayload, timerStopFields } from "./stop-fields";

const timer = (patch: Partial<Timer> = {}): Timer => ({
	id: "t",
	startedAt: "2026-08-10T08:00:00.000Z",
	droppedAt: null,
	paused: true,
	elapsedSeconds: 5400,
	snappedSeconds: 5400,
	serverNow: "2026-08-10T09:30:00.000Z",
	description: "Old note",
	task: { id: "task1", name: "Dev", needsDescription: false },
	project: { id: "p1", name: "Internal" },
	entry: { id: "e1", date: "2026-08-09", durationSeconds: 1800 },
	organization: { slug: "o", name: "O", here: true },
	...patch,
});

const live = (t: Timer) => timerStopFields(t, "Europe/Zagreb");

describe("timerStopFields", () => {
	test("takes the day of a continued entry", () => {
		expect(live(timer()).date).toBe("2026-08-09");
	});

	test("takes the start day of a new entry", () => {
		expect(live(timer({ entry: null })).date).toBe("2026-08-10");
	});
});

describe("stopPayload", () => {
	test("sends only the measured part when nothing changed", () => {
		const t = timer();
		expect(stopPayload({ timer: t, live: live(t), edits: {} })).toEqual({
			measuredSeconds: 3600,
		});
	});

	test("sends measured time without an entry as the whole figure", () => {
		const t = timer({ entry: null });
		expect(stopPayload({ timer: t, live: live(t), edits: {} })).toEqual({
			measuredSeconds: 5400,
		});
	});

	test("sends a changed field and a corrected duration", () => {
		const t = timer();
		const body = stopPayload({
			timer: t,
			live: live(t),
			edits: { description: " New ", projectId: null, seconds: 900 },
		});
		expect(body).toEqual({
			description: "New",
			projectId: null,
			durationSeconds: 900,
		});
	});

	test("leaves out an edit that equals the live value", () => {
		const t = timer();
		const body = stopPayload({
			timer: t,
			live: live(t),
			edits: { description: "Old note", seconds: 5400 },
		});
		expect(body).toEqual({ measuredSeconds: 3600 });
	});

	test("never sends a stale note after the timer refetches", () => {
		const first = timer();
		const next = timer({ description: "Edited on the entry" });
		const edits = {};
		expect(stopFormFields(live(first), edits).description).toBe("Old note");
		expect(stopFormFields(live(next), edits).description).toBe(
			"Edited on the entry",
		);
		expect(stopPayload({ timer: next, live: live(next), edits })).toEqual({
			measuredSeconds: 3600,
		});
	});

	test("keeps a typed note when the timer refetches", () => {
		const next = timer({ description: "Edited on the entry" });
		const edits = { description: "Typed" };
		expect(stopFormFields(live(next), edits).description).toBe("Typed");
		expect(stopPayload({ timer: next, live: live(next), edits })).toEqual({
			description: "Typed",
			measuredSeconds: 3600,
		});
	});
});
