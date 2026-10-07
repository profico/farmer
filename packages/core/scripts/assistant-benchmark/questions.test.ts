// The checks decide every score in the benchmark, so a wrong check would
// spoil a paid run. These tests give each check a trace that must pass and a
// trace that must fail.

import { describe, expect, test } from "bun:test";

import { at } from "../../src/test/harness";
import {
	mentions,
	numbersIn,
	QUESTIONS,
	type Question,
	type Trace,
} from "./questions";
import type { Seeded } from "./seed";

const seeded: Seeded = {
	reader: { organizationId: "org", userId: "reader" },
	writer: { organizationId: "org", userId: "writer" },
	today: "2026-10-07",
	yesterday: "2026-10-06",
	nextMonday: "2026-10-12",
	lastWeek: { from: "2026-09-28", to: "2026-10-04" },
	lastMonth: { from: "2026-09-01", to: "2026-09-30" },
	people: 40,
	entries: 1,
	ids: {
		atlasProjectId: "atlas",
		developmentTaskId: "dev",
		vacationTaskId: "vac",
		writerYesterdayEntryId: "entry",
		targetAttachmentIds: ["a", "b", "c"],
	},
	truth: {
		readerLastWeekHours: 15,
		readerLastMonthHours: 81,
		companyLastMonthHours: 3038.5,
		deltaLastMonthHours: 357.5,
		overtimeTopName: "Boris Jelic",
		overtimeTopHours: 48,
		onLeaveName: "Zara Babic",
		onLeaveDays: 15,
	},
	reset: async () => undefined,
};

const trace = (patch: Partial<Trace>): Trace => ({
	answer: "",
	calls: [],
	executed: [],
	approval: null,
	...patch,
});

const question = (id: string): Question =>
	at(
		QUESTIONS.filter((candidate) => candidate.id === id),
		0,
	);
const check = (id: string, patch: Partial<Trace>) =>
	question(id).check(trace(patch), seeded).pass;

describe("number reading", () => {
	test("reads thousands, decimals and hours with minutes", () => {
		expect(numbersIn("3,038.5 hours")).toContain(3038.5);
		expect(numbersIn("87,75 h")).toContain(87.75);
		expect(mentions("You logged 81h 15m", 81.25)).toBe(true);
		expect(mentions("You logged 80 hours", 81, 0.5)).toBe(false);
	});
});

describe("report checks", () => {
	test("own hours pass, the company total fails", () => {
		expect(check("own-vs-company", { answer: "You logged 81 hours." })).toBe(
			true,
		);
		const verdict = question("own-vs-company").check(
			trace({ answer: "Total: 3,038.5 hours." }),
			seeded,
		);
		expect(verdict.pass).toBe(false);
		expect(verdict.reason).toContain("company total");
	});

	test("overtime needs the name, and absence takes days or hours", () => {
		expect(check("overtime", { answer: "Boris Jelic, 48 h." })).toBe(true);
		expect(check("overtime", { answer: "Zara Babic." })).toBe(false);
		expect(check("absence", { answer: "15 days" })).toBe(true);
		expect(check("absence", { answer: "120 hours" })).toBe(true);
		expect(check("absence", { answer: "13 days" })).toBe(false);
	});
});

describe("write checks", () => {
	test("create passes for one correct entry only", () => {
		const input = JSON.stringify({
			date: "2026-10-06",
			projectId: "atlas",
			taskId: "dev",
			durationSeconds: 7200,
			description: "code review",
		});
		const run = { name: "create_time_entry", input, ok: true };
		expect(check("create-entry", { executed: [run] })).toBe(true);
		expect(check("create-entry", { executed: [run, run] })).toBe(false);
		expect(
			check("create-entry", {
				executed: [{ ...run, input: input.replace("7200", "3600") }],
			}),
		).toBe(false);
	});

	test("update names the entry and the text", () => {
		const input = JSON.stringify({
			timeEntryId: "entry",
			description: "Reviewed the export PR",
		});
		expect(
			check("update-entry", {
				executed: [{ name: "update_entry_description", input, ok: true }],
			}),
		).toBe(true);
		expect(
			check("update-entry", {
				executed: [
					{
						name: "update_entry_description",
						input: input.replace("entry", "other"),
						ok: true,
					},
				],
			}),
		).toBe(false);
	});

	test("vacation needs the approval, the task and the day", () => {
		const approval = (from: string) => ({
			name: "log_absence",
			arguments: JSON.stringify({ taskId: "vac", from, to: from }),
		});
		expect(check("book-vacation", { approval: approval("2026-10-12") })).toBe(
			true,
		);
		expect(check("book-vacation", { approval: approval("2026-10-08") })).toBe(
			false,
		);
		expect(check("book-vacation", { answer: "Done." })).toBe(false);
	});

	test("unlink needs exactly the target ids", () => {
		const approval = (ids: string[]) => ({
			name: "unlink_commits",
			arguments: JSON.stringify({ attachmentIds: ids }),
		});
		expect(
			check("unlink-commits", { approval: approval(["c", "a", "b"]) }),
		).toBe(true);
		expect(check("unlink-commits", { approval: approval(["a", "b"]) })).toBe(
			false,
		);
		expect(
			check("unlink-commits", { approval: approval(["a", "b", "c", "d"]) }),
		).toBe(false);
	});

	test("fill-day needs the read of yesterday", () => {
		const read = (date: string) => ({
			name: "suggest_day",
			input: JSON.stringify({ date }),
			ok: true,
		});
		expect(
			check("fill-day", { executed: [read("2026-10-06")], answer: "Add 7 h." }),
		).toBe(true);
		expect(
			check("fill-day", { executed: [read("2026-10-05")], answer: "Add 7 h." }),
		).toBe(false);
	});
});
