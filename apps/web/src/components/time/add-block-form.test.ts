/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	activeOptionLabels,
	buildDefaults,
	dialogDateLabel,
	dialogVisibility,
	type ExistingTimeEntry,
	type FormValues,
	groupAttachedPullRequests,
	NO_PROJECT_YET,
	saveLabel,
	saveNotice,
	selectedCommitRefs,
	selectedPullRequestRefs,
	TIME_OFF,
	toEntryPayload,
	toRulePayload,
	unattachedCommits,
} from "./add-block-form.ts";

const entry = (over: Partial<ExistingTimeEntry> = {}): ExistingTimeEntry => ({
	id: "e1",
	date: "2026-09-15",
	projectId: "p1",
	taskId: "t1",
	description: "Did a thing",
	durationSeconds: 5400,
	overtime: true,
	fillsDay: false,
	generatedFromRuleId: null,
	...over,
});

const values = (over: Partial<FormValues> = {}): FormValues => ({
	projectId: "p1",
	taskId: "t1",
	date: "2026-09-15",
	duration: "1.5",
	description: "Work",
	overtime: false,
	fillsDay: false,
	repeatEnabled: false,
	daysOfWeek: [2],
	repeatEndDate: "",
	...over,
});

describe("buildDefaults", () => {
	test("a new entry opens on Time-off with the repeat day of the date", () => {
		// 2026-09-15 is a Tuesday.
		expect(buildDefaults(undefined, "2026-09-15", undefined, "UTC")).toEqual({
			projectId: TIME_OFF,
			taskId: "",
			date: "2026-09-15",
			duration: "",
			description: "",
			overtime: false,
			fillsDay: false,
			repeatEnabled: false,
			daysOfWeek: [2],
			repeatEndDate: "",
		});
	});

	test("the project of the page wins for a new entry", () => {
		expect(buildDefaults(undefined, "2026-09-15", "p9", "UTC").projectId).toBe(
			"p9",
		);
	});

	test("an entry fills the form from its own values", () => {
		expect(buildDefaults(entry(), "2026-09-15", "p9", "UTC")).toMatchObject({
			projectId: "p1",
			taskId: "t1",
			duration: "1:30",
			description: "Did a thing",
			overtime: true,
		});
	});

	test("an unfiled worked entry opens as no project yet", () => {
		const unfiled = entry({ projectId: null, task: { isAbsence: false } });
		expect(buildDefaults(unfiled, "2026-09-15", "p9", "UTC").projectId).toBe(
			NO_PROJECT_YET,
		);
	});

	test("an entry with no project and no task flag opens as Time-off", () => {
		const off = entry({ projectId: null });
		expect(buildDefaults(off, "2026-09-15", undefined, "UTC").projectId).toBe(
			TIME_OFF,
		);
	});
});

describe("dialogDateLabel", () => {
	test("spells the weekday, the month and the year", () => {
		expect(dialogDateLabel("2026-09-15")).toBe("Tuesday, September 15, 2026");
	});

	test("returns a malformed key as it is", () => {
		expect(dialogDateLabel("soon")).toBe("soon");
		expect(dialogDateLabel("2026-xx-15")).toBe("2026-xx-15");
	});
});

describe("groupAttachedPullRequests", () => {
	const row = (id: string, url: string, kind: "opened" | "reviewed") => ({
		id,
		pullRequestUrl: url,
		number: url.endsWith("/1") ? 1 : 2,
		title: `PR ${url}`,
		kind,
		reviewState: kind === "reviewed" ? ("approved" as const) : null,
	});

	test("makes one group per pull request, in first-seen order", () => {
		const groups = groupAttachedPullRequests([
			row("a", "https://x/pull/1", "opened"),
			row("b", "https://x/pull/2", "opened"),
			row("c", "https://x/pull/1", "reviewed"),
		]);
		expect(groups.map((g) => g.pullRequestUrl)).toEqual([
			"https://x/pull/1",
			"https://x/pull/2",
		]);
		expect(groups[0]?.ids).toEqual(["a", "c"]);
		expect(groups[0]?.events).toEqual([
			{ kind: "opened", reviewState: null },
			{ kind: "reviewed", reviewState: "approved" },
		]);
		expect(groups[1]?.ids).toEqual(["b"]);
	});

	test("returns nothing for no rows", () => {
		expect(groupAttachedPullRequests([])).toEqual([]);
		expect(groupAttachedPullRequests(undefined)).toEqual([]);
	});
});

describe("toEntryPayload", () => {
	const none = { meetingUrl: null, calendarEventId: null };

	test("snaps the typed duration to a quarter hour", () => {
		expect(toEntryPayload(values({ duration: "1.5" }), none)).toEqual({
			taskId: "t1",
			projectId: "p1",
			description: "Work",
			date: "2026-09-15",
			durationSeconds: 5400,
			overtime: false,
			fillsDay: false,
			meetingUrl: undefined,
			calendarEventId: undefined,
		});
	});

	test("maps both sentinels to no project", () => {
		expect(
			toEntryPayload(values({ projectId: TIME_OFF }), none).projectId,
		).toBeUndefined();
		expect(
			toEntryPayload(values({ projectId: NO_PROJECT_YET }), none).projectId,
		).toBeUndefined();
	});

	test("sends no duration for a fill block, and drops the meeting", () => {
		const payload = toEntryPayload(values({ fillsDay: true }), {
			meetingUrl: "https://meet/x",
			calendarEventId: "ev1",
		});
		expect(payload.durationSeconds).toBeUndefined();
		expect(payload.meetingUrl).toBeUndefined();
		expect(payload.calendarEventId).toBeUndefined();
	});

	test("keeps the picked meeting on a timed entry", () => {
		const payload = toEntryPayload(values(), {
			meetingUrl: "https://meet/x",
			calendarEventId: "ev1",
		});
		expect(payload.meetingUrl).toBe("https://meet/x");
		expect(payload.calendarEventId).toBe("ev1");
	});

	test("sends no duration when the text does not parse", () => {
		expect(
			toEntryPayload(values({ duration: "abc" }), none).durationSeconds,
		).toBeUndefined();
	});

	test("turns an empty note into no note", () => {
		expect(
			toEntryPayload(values({ description: "" }), none).description,
		).toBeUndefined();
	});
});

describe("toRulePayload", () => {
	test("keeps the typed duration and maps the empty end date", () => {
		expect(
			toRulePayload(values({ projectId: TIME_OFF, daysOfWeek: [1, 3] })),
		).toEqual({
			taskId: "t1",
			projectId: undefined,
			description: "Work",
			daysOfWeek: [1, 3],
			duration: "1.5",
			effectiveFrom: "2026-09-15",
			effectiveUntil: undefined,
		});
	});
});

describe("saveLabel", () => {
	test("says Saving while the save runs", () => {
		expect(
			saveLabel({ pending: true, isEdit: false, repeatEnabled: true }),
		).toBe("Saving…");
	});

	test("says Save entry for an edit, even with repeat on", () => {
		expect(
			saveLabel({ pending: false, isEdit: true, repeatEnabled: true }),
		).toBe("Save entry");
	});

	test("says Create repeating entry for a new repeat", () => {
		expect(
			saveLabel({ pending: false, isEdit: false, repeatEnabled: true }),
		).toBe("Create repeating entry");
	});

	test("says Save entry otherwise", () => {
		expect(
			saveLabel({ pending: false, isEdit: false, repeatEnabled: false }),
		).toBe("Save entry");
	});
});

describe("dialogVisibility", () => {
	const base = {
		isEdit: false,
		repeatEnabled: false,
		fillsDay: false,
		isAbsence: false,
		hasProject: true,
		meetingTask: undefined,
		github: { connected: true },
		google: { connected: true },
		linkedRepos: [{}],
		attachedCommits: undefined,
		attachedPullRequests: undefined,
	};

	test("a new entry on a linked project offers the commit picker", () => {
		expect(dialogVisibility(base)).toEqual({
			showCommitPicker: true,
			showAttachedCommits: false,
			showAttachedPullRequests: false,
			showGithubSection: true,
			showCalendarPicker: false,
			showRepeatSection: true,
			showFillPreset: true,
			dayLocked: false,
		});
	});

	test("the picker needs a project, a connection and a linked repo", () => {
		expect(
			dialogVisibility({ ...base, hasProject: false }).showCommitPicker,
		).toBe(false);
		expect(
			dialogVisibility({ ...base, github: undefined }).showCommitPicker,
		).toBe(false);
		expect(
			dialogVisibility({ ...base, linkedRepos: [] }).showCommitPicker,
		).toBe(false);
		expect(dialogVisibility({ ...base, fillsDay: true }).showCommitPicker).toBe(
			false,
		);
	});

	test("attachments show without a project and lock the day of an edit", () => {
		const v = dialogVisibility({
			...base,
			isEdit: true,
			hasProject: false,
			attachedCommits: [{}],
			attachedPullRequests: [{}],
		});
		expect(v.showCommitPicker).toBe(false);
		expect(v.showAttachedCommits).toBe(true);
		expect(v.showAttachedPullRequests).toBe(true);
		expect(v.showGithubSection).toBe(true);
		expect(v.dayLocked).toBe(true);
		expect(v.showRepeatSection).toBe(false);
	});

	test("attachments do not lock the day of a new entry", () => {
		expect(dialogVisibility({ ...base, attachedCommits: [{}] }).dayLocked).toBe(
			false,
		);
	});

	test("repeat hides the pickers and the fill preset", () => {
		const v = dialogVisibility({
			...base,
			repeatEnabled: true,
			attachedCommits: [{}],
			meetingTask: { systemKey: "meeting" },
		});
		expect(v.showCommitPicker).toBe(false);
		expect(v.showAttachedCommits).toBe(false);
		expect(v.showCalendarPicker).toBe(false);
		expect(v.showFillPreset).toBe(false);
	});

	test("the calendar picker needs the Meeting task and Google", () => {
		const meeting = { systemKey: "meeting" };
		expect(
			dialogVisibility({ ...base, meetingTask: meeting }).showCalendarPicker,
		).toBe(true);
		expect(
			dialogVisibility({ ...base, meetingTask: { systemKey: "break" } })
				.showCalendarPicker,
		).toBe(false);
		expect(
			dialogVisibility({ ...base, meetingTask: meeting, google: undefined })
				.showCalendarPicker,
		).toBe(false);
		expect(
			dialogVisibility({ ...base, meetingTask: meeting, fillsDay: true })
				.showCalendarPicker,
		).toBe(false);
	});

	test("an absence has no fill preset and no repeat section", () => {
		const v = dialogVisibility({ ...base, isAbsence: true });
		expect(v.showFillPreset).toBe(false);
		expect(v.showRepeatSection).toBe(false);
	});

	test("a fill block hides the repeat section but keeps the preset", () => {
		const v = dialogVisibility({ ...base, fillsDay: true });
		expect(v.showRepeatSection).toBe(false);
		expect(v.showFillPreset).toBe(true);
	});
});

describe("selected refs", () => {
	const commits = [
		{ projectGithubRepoId: "r1", sha: "aaa", message: "one" },
		{ projectGithubRepoId: "r1", sha: "bbb", message: "two" },
	];

	test("selectedCommitRefs keeps the ticked commits in order", () => {
		expect(selectedCommitRefs(commits, new Set(["r1:bbb", "r1:aaa"]))).toEqual([
			{ projectGithubRepoId: "r1", sha: "aaa" },
			{ projectGithubRepoId: "r1", sha: "bbb" },
		]);
		expect(selectedCommitRefs(commits, new Set())).toEqual([]);
	});

	test("selectedPullRequestRefs keeps the ticked pull requests", () => {
		const prs = [
			{ projectGithubRepoId: "r1", number: 4 },
			{ projectGithubRepoId: "r2", number: 4 },
		];
		expect(selectedPullRequestRefs(prs, new Set(["r2:4"]))).toEqual([
			{ projectGithubRepoId: "r2", number: 4 },
		]);
	});

	test("unattachedCommits drops the commits the entry already holds", () => {
		expect(
			unattachedCommits(commits, [{ sha: "aaa" }]).map((c) => c.sha),
		).toEqual(["bbb"]);
	});
});

describe("activeOptionLabels", () => {
	test("lists the options that are on", () => {
		expect(activeOptionLabels(false, false)).toEqual([]);
		expect(activeOptionLabels(true, false)).toEqual(["Repeat"]);
		expect(activeOptionLabels(true, true)).toEqual(["Repeat", "Overtime"]);
	});
});

describe("saveNotice", () => {
	const day = { date: "2026-09-15", repeatEnabled: false };

	test("says nothing for a save on the day the dialog opened on", () => {
		expect(saveNotice(day, "2026-09-15", [])).toBeNull();
	});

	test("names the day for a save to a different day", () => {
		expect(saveNotice(day, "2026-09-14", [])).toEqual({
			tone: "success",
			text: "Saved to September 15, 2026",
		});
	});

	test("says the entry is saved when an attach fails", () => {
		expect(saveNotice(day, "2026-09-15", ["commits"])).toEqual({
			tone: "error",
			text: "Saved. The commits were not attached. Try again from the entry.",
		});
	});

	test("names the day and each kind that did not attach", () => {
		expect(
			saveNotice(day, "2026-09-14", ["commits", "pull requests"])?.text,
		).toBe(
			"Saved to September 15, 2026. The commits and pull requests were not attached. Try again from the entry.",
		);
	});

	test("a repeat rule has no day to name", () => {
		expect(
			saveNotice({ ...day, repeatEnabled: true }, "2026-09-14", []),
		).toBeNull();
	});
});
