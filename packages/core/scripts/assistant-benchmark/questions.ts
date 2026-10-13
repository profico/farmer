// The benchmark questions, and the check for each one.
//
// A report question is graded on the figure or the name in the answer, never
// on the wording. A write question is graded on the tool and the arguments
// that the model chose. A tool that needs approval stops the turn at the
// approval card, and the benchmark never approves it.

import { z } from "zod";

import { TARGET_REPO, type Seeded } from "./seed";

/** One tool call that the model asked for. */
export type Call = { name: string; arguments: string };

/** One tool run that the loop executed. */
export type Executed = { name: string; input: string; ok: boolean };

/** What one run produced, for a check to read. */
export type Trace = {
	answer: string;
	/** Every call of a generation that finished, in order. */
	calls: Call[];
	executed: Executed[];
	/** The first call that stopped the turn for approval, or null. */
	approval: Call | null;
};

export type Verdict = { pass: boolean; reason: string };

export type Question = {
	id: string;
	/** Which seeded user asks. The writer owns the entries that a write changes. */
	caller: "reader" | "writer";
	ask: (seeded: Seeded) => string;
	check: (trace: Trace, seeded: Seeded) => Verdict;
};

const pass = (reason = "ok"): Verdict => ({ pass: true, reason });
const fail = (reason: string): Verdict => ({ pass: false, reason });

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";

/** The text without dates, times and years. A date holds numbers that are not
 *  a figure, and they move with the run date. */
const withoutDates = (text: string): string =>
	text
		.replace(/\d{4}-\d{2}-\d{2}/g, " ")
		.replace(new RegExp(`\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}`, "gi"), " ")
		.replace(new RegExp(`${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?`, "gi"), " ")
		.replace(/\d{1,2}:\d{2}/g, " ")
		.replace(/\b(?:19|20)\d{2}\b/g, " ");

/** The figures in a text. A figure with a unit (hours or days) is read first.
 *  A text with no unit falls back to every number. "87h 45m" and "1,234.5"
 *  are one number each. */
export const numbersIn = (text: string): number[] => {
	const cleaned = withoutDates(text)
		.replace(/(\d),(\d{3})(?!\d)/g, "$1$2")
		.replace(/(\d),(\d)/g, "$1.$2");
	const all = [...cleaned.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
	const withUnit = [
		...cleaned.matchAll(/(\d+(?:\.\d+)?)[\s*_`]*(?:h|hr|hrs|hours?|days?)\b/gi),
	].map((m) => Number(m[1]));
	for (const m of cleaned.matchAll(/(\d+)\s*h(?:ours?)?\s*(\d+)\s*m/gi)) {
		withUnit.push(Number(m[1]) + Number(m[2]) / 60);
	}
	return withUnit.length > 0 ? withUnit : all;
};

/** A number that is within the tolerance. The default is a tenth of an hour. */
export const mentions = (text: string, target: number, tolerance = 0.1) =>
	numbersIn(text).some((value) => Math.abs(value - target) <= tolerance);

const includes = (text: string, needle: string) =>
	text.toLowerCase().includes(needle.toLowerCase());

const parseArguments = <T extends z.ZodType>(
	raw: string,
	schema: T,
): z.infer<T> | null => {
	try {
		const result = schema.safeParse(JSON.parse(raw));
		return result.success ? result.data : null;
	} catch {
		return null;
	}
};

const figure = (value: number) => value.toFixed(2);

const reportCheck =
	(
		pick: (seeded: Seeded) => number,
		trap?: (seeded: Seeded) => number,
		tolerance = 0.1,
	) =>
	(trace: Trace, seeded: Seeded): Verdict => {
		const expected = pick(seeded);
		if (mentions(trace.answer, expected, tolerance)) return pass();
		if (trap && mentions(trace.answer, trap(seeded))) {
			return fail(
				`answered the company total ${figure(trap(seeded))}, the person's own is ${figure(expected)}`,
			);
		}
		return fail(
			trace.answer === ""
				? "no answer"
				: `expected ${figure(expected)} in the answer`,
		);
	};

const createInput = z.object({
	date: z.string(),
	projectId: z.string().optional(),
	taskId: z.string(),
	durationSeconds: z.number().optional(),
});
const updateInput = z.object({
	timeEntryId: z.string(),
	description: z.string().optional(),
});
const absenceInput = z.object({
	taskId: z.string(),
	from: z.string(),
	to: z.string(),
});
const unlinkInput = z.object({ attachmentIds: z.array(z.string()) });
const suggestInput = z.object({ date: z.string() });

const executedOk = (trace: Trace, name: string) =>
	trace.executed.filter((run) => run.name === name && run.ok);

const wrongApproval = (trace: Trace, expected: string): Verdict | null => {
	if (!trace.approval) {
		return fail(
			trace.answer === ""
				? "no approval requested and no answer"
				: "no approval requested",
		);
	}
	if (trace.approval.name !== expected) {
		return fail(`approval for ${trace.approval.name}, expected ${expected}`);
	}
	return null;
};

const sameSet = (left: string[], right: string[]) =>
	left.length === right.length &&
	new Set(left).size === left.length &&
	right.every((id) => left.includes(id));

export const QUESTIONS: Question[] = [
	{
		id: "own-last-week",
		caller: "reader",
		ask: () => "How many hours did I log last week?",
		check: reportCheck((seeded) => seeded.truth.readerLastWeekHours),
	},
	{
		// The trap from the 16 Sep 2026 run. `time_report_summary` with no user
		// returns every person that the caller may see. Ten of 13 models then
		// answered the total of the company.
		id: "own-vs-company",
		caller: "reader",
		ask: () => "How many hours did I log last month?",
		check: reportCheck(
			(seeded) => seeded.truth.readerLastMonthHours,
			(seeded) => seeded.truth.companyLastMonthHours,
		),
	},
	{
		id: "team-project",
		caller: "reader",
		ask: () =>
			"How many hours did the whole team log on Delta Analytics last month?",
		check: reportCheck(
			(seeded) => seeded.truth.deltaLastMonthHours,
			undefined,
			0.5,
		),
	},
	{
		id: "overtime",
		caller: "reader",
		ask: () => "Who logged the most overtime in the last 60 days?",
		check: (trace, seeded) =>
			includes(trace.answer, seeded.truth.overtimeTopName)
				? pass()
				: fail(`expected ${seeded.truth.overtimeTopName} in the answer`),
	},
	{
		id: "absence",
		caller: "reader",
		ask: (seeded) =>
			`How many vacation days has ${seeded.truth.onLeaveName} taken in the last 60 days?`,
		check: (trace, seeded) =>
			mentions(trace.answer, seeded.truth.onLeaveDays, 0.01) ||
			mentions(trace.answer, seeded.truth.onLeaveDays * 8, 0.1)
				? pass()
				: fail(`expected ${seeded.truth.onLeaveDays} days in the answer`),
	},
	{
		id: "create-entry",
		caller: "writer",
		ask: () =>
			"Log 2 hours of Development on Atlas Platform for yesterday. Description: code review.",
		check: (trace, seeded) => {
			const created = executedOk(trace, "create_time_entry");
			if (created.length === 0) return fail("no entry was created");
			if (created.length > 1) return fail(`${created.length} entries created`);
			const input = parseArguments(created[0]?.input ?? "", createInput);
			if (!input) return fail("the arguments do not parse");
			if (input.date !== seeded.yesterday) return fail(`date ${input.date}`);
			if (input.projectId !== seeded.ids.atlasProjectId)
				return fail("wrong project");
			if (input.taskId !== seeded.ids.developmentTaskId)
				return fail("wrong task");
			if (input.durationSeconds !== 7200)
				return fail(`duration ${String(input.durationSeconds)}`);
			return pass();
		},
	},
	{
		id: "update-entry",
		caller: "writer",
		ask: () =>
			'Change the description of my entry from yesterday to "Reviewed the export PR".',
		check: (trace, seeded) => {
			const runs = [
				...executedOk(trace, "update_entry_description"),
				...executedOk(trace, "update_time_entry"),
			];
			if (runs.length === 0) return fail("no entry was updated");
			const good = runs.some((run) => {
				const input = parseArguments(run.input, updateInput);
				return (
					input?.timeEntryId === seeded.ids.writerYesterdayEntryId &&
					includes(input.description ?? "", "Reviewed the export PR")
				);
			});
			return good ? pass() : fail("the update names the wrong entry or text");
		},
	},
	{
		id: "book-vacation",
		caller: "writer",
		ask: () => "Book a vacation day for me next Monday.",
		check: (trace, seeded) => {
			const wrong = wrongApproval(trace, "log_absence");
			if (wrong) return wrong;
			const input = parseArguments(
				trace.approval?.arguments ?? "",
				absenceInput,
			);
			if (!input) return fail("the arguments do not parse");
			if (input.taskId !== seeded.ids.vacationTaskId)
				return fail("not the vacation task");
			if (input.from !== seeded.nextMonday || input.to !== seeded.nextMonday)
				return fail(`range ${input.from} to ${input.to}`);
			return pass();
		},
	},
	{
		// The wording does not copy the example in the tool description.
		id: "unlink-commits",
		caller: "writer",
		ask: () =>
			"Take the commits from the farmer repo off my time entry for yesterday.",
		check: (trace, seeded) => {
			const wrong = wrongApproval(trace, "unlink_commits");
			if (wrong) return wrong;
			const input = parseArguments(
				trace.approval?.arguments ?? "",
				unlinkInput,
			);
			if (!input) return fail("the arguments do not parse");
			return sameSet(input.attachmentIds, seeded.ids.targetAttachmentIds)
				? pass()
				: fail(
						`${input.attachmentIds.length} ids, expected the ${seeded.ids.targetAttachmentIds.length} of ${TARGET_REPO} on yesterday`,
					);
		},
	},
	{
		id: "fill-day",
		caller: "writer",
		ask: () => "What is missing from my day yesterday? Suggest how to fill it.",
		check: (trace, seeded) => {
			const read = executedOk(trace, "suggest_day").some(
				(run) =>
					parseArguments(run.input, suggestInput)?.date === seeded.yesterday,
			);
			if (!read) return fail("suggest_day was not called for yesterday");
			if (trace.approval && trace.approval.name !== "apply_day_assembly")
				return fail(`approval for ${trace.approval.name}`);
			return trace.approval || trace.answer !== "" ? pass() : fail("no answer");
		},
	},
];
