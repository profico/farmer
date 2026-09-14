import type {
	ApiAbsenceResult,
	ApiCopyResult,
	ApiFileResult,
	ApiProject,
	ApiTaskList,
	ApiUnfiledEntry,
} from "@farmer/core/api";
import { addDaysToKey, startOfWeekKey } from "@farmer/core/lib/time";
import type {
	CopyTimeEntriesInput,
	CopyWeekEntriesInput,
	FileTimeEntriesInput,
	LogAbsenceRangeInput,
} from "@farmer/core/schema";

import {
	type DaySpan,
	parseDay,
	parseDaySpan,
	todayKey,
	weekAround,
} from "../dates";
import { formatHours } from "../duration";
import { CliError, UsageError } from "../errors";
import { bold, createOutput, print, printJson, warn } from "../output";
import { chooseProject, chooseTask, findByIdPrefix, isUuid } from "../pick";
import { pickMany, requireInteractive } from "../prompts";
import { dayTitle, plural, printTable, shortId, spanTitle } from "../render";
import { openOrg, type OrgScope, type Session } from "../session";
import { type Command, parseCommandArgs } from "./command";

const listUnfiled = (session: Session, scope: OrgScope, span: DaySpan) =>
	session.api.get<ApiUnfiledEntry[]>(
		scope.path(`/unfiled?${new URLSearchParams(span)}`),
	);

const UNFILED_USAGE = "farmer unfiled [--week] [-d date]";

export const unfiled: Command = {
	name: "unfiled",
	usage: UNFILED_USAGE,
	summary: "List worked time that has no project yet. The default is today.",
	help: [
		"  --week        The whole week, as the organization starts it.",
		"  -d, --date    The day, or a day in the week. The default is today.",
	],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(
			args,
			{ week: { type: "boolean" }, date: { type: "string", short: "d" } },
			0,
			UNFILED_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope } = await openOrg(runtime, out, values.org);
		const day = parseDay(values.date ?? "today", scope.clock);
		const span = values.week
			? weekAround(day, scope.clock.weekStartsOn)
			: { from: day, to: day };
		const items = await listUnfiled(session, scope, span);

		if (out.json) {
			printJson(items);
			return;
		}
		print(bold(out, `Unfiled, ${spanTitle(span)}`));
		if (items.length === 0) {
			print("Nothing to file.");
			return;
		}
		const total = items.reduce((sum, item) => sum + item.durationSeconds, 0);
		printTable(out, {
			columns: [
				{ header: "ID" },
				{ header: "Date" },
				{ header: "Time", align: "right" },
				{ header: "Task" },
				{ header: "Description", shrink: true },
			],
			rows: items.map((item) => [
				shortId(item.id),
				item.date,
				formatHours(item.durationSeconds),
				item.task.name,
				item.description,
			]),
			total: [
				"Total",
				"",
				formatHours(total),
				"",
				plural(items.length, "entry", "entries"),
			],
		});
	},
};

const FILE_USAGE = "farmer file [ids...] [-p project] [--remember]";

export const file: Command = {
	name: "file",
	usage: FILE_USAGE,
	summary: "Put unfiled entries on a project.",
	help: [
		"  [ids...]      Ids or their first characters. Without ids, choose from",
		"                this week's unfiled entries.",
		"  -p, --project The project.",
		"  --remember    Always file meetings with these titles on this project.",
		"  -d, --date    A day in the week to choose from. The default is today.",
	],
	run: async (args, runtime) => {
		const { values, positionals } = parseCommandArgs(
			args,
			{
				project: { type: "string", short: "p" },
				remember: { type: "boolean" },
				date: { type: "string", short: "d" },
			},
			Number.POSITIVE_INFINITY,
			FILE_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope } = await openOrg(runtime, out, values.org);
		const span = weekAround(
			parseDay(values.date ?? "today", scope.clock),
			scope.clock.weekStartsOn,
		);
		const candidates = await listUnfiled(session, scope, span);

		let ids: string[];
		if (positionals.length > 0) {
			ids = positionals.map((typed) => {
				const found = findByIdPrefix(candidates, typed);
				if (found) return found.id;
				if (isUuid(typed)) return typed.toLowerCase();
				throw new UsageError(
					`No unfiled entry in the week of ${span.from} has an id that starts with "${typed}".`,
				);
			});
		} else {
			if (candidates.length === 0) {
				if (out.json) printJson({ filed: 0, failed: 0, firstError: null });
				else print(`Nothing to file in the week of ${span.from}.`);
				return;
			}
			requireInteractive(
				out,
				"Pass the ids to file. `farmer unfiled --week` shows them.",
			);
			ids = await pickMany(
				"Which entries do you want to file?",
				candidates.map((item) => ({
					value: item.id,
					label: `${dayTitle(item.date)}  ${formatHours(item.durationSeconds)}  ${item.description || item.task.name}`,
					hint: item.task.name,
				})),
			);
		}

		const projects = await session.api.get<ApiProject[]>(
			scope.path("/projects"),
		);
		const project = await chooseProject(out, projects, values.project);
		const result = await session.api.post<ApiFileResult, FileTimeEntriesInput>(
			scope.path("/time-entries/file"),
			{
				timeEntryIds: [...new Set(ids)],
				projectId: project.id,
				remember: values.remember === true,
			},
		);

		if (out.json) {
			printJson(result);
			return;
		}
		print(
			`Filed ${plural(result.filed, "entry", "entries")} on ${project.name}.`,
		);
		if (result.failed > 0) {
			warn(
				`${plural(result.failed, "entry", "entries")} could not be filed${result.firstError ? `: ${result.firstError}` : "."}`,
			);
			process.exitCode = 1;
		}
	},
};

const reportCopy = (json: boolean, result: ApiCopyResult, what: string) => {
	if (json) {
		printJson(result);
		return;
	}
	const skipped =
		result.skipped > 0
			? ` ${plural(result.skipped, "entry", "entries")} skipped.`
			: "";
	print(
		`Copied ${plural(result.copied, "entry", "entries")} ${what}.${skipped}`,
	);
	if (result.blockedDays.length > 0) {
		warn(
			`Not copied onto ${result.blockedDays.join(", ")}: the day would pass 24 hours.`,
		);
	}
};

const COPY_DAY_USAGE = "farmer copy day <from> [to]";

export const copyDay: Command = {
	name: "copy day",
	usage: COPY_DAY_USAGE,
	summary:
		"Copy one day's entries onto another day. The default target is today.",
	help: ["  Dates: today, yesterday, a weekday name, or yyyy-MM-dd."],
	run: async (args, runtime) => {
		const { values, positionals } = parseCommandArgs(
			args,
			{},
			2,
			COPY_DAY_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		const [fromText, toText] = positionals;
		if (fromText === undefined) {
			throw new UsageError(`Say which day to copy.\nUsage: ${COPY_DAY_USAGE}`);
		}
		const { session, scope } = await openOrg(runtime, out, values.org);
		const fromDate = parseDay(fromText, scope.clock);
		const toDate = parseDay(toText ?? "today", scope.clock);
		if (fromDate === toDate) {
			throw new UsageError("A day cannot be copied onto itself.");
		}
		const result = await session.api.post<ApiCopyResult, CopyTimeEntriesInput>(
			scope.path("/time-entries/copy-day"),
			{ fromDate, toDate },
		);
		reportCopy(
			out.json,
			result,
			`from ${dayTitle(fromDate)} to ${dayTitle(toDate)}`,
		);
	},
};

const COPY_WEEK_USAGE = "farmer copy week [--last] [from] [to]";

export const copyWeek: Command = {
	name: "copy week",
	usage: COPY_WEEK_USAGE,
	summary: "Copy last week's entries onto this week.",
	help: [
		"  --last        Copy the week before last onto last week instead.",
		"  [from] [to]   Any day in the source week and in the target week. The",
		"                default target is this week.",
		"",
		"Each day lands on the same weekday. A day that would pass 24 hours is",
		"left alone.",
	],
	run: async (args, runtime) => {
		const { values, positionals } = parseCommandArgs(
			args,
			{ last: { type: "boolean" } },
			2,
			COPY_WEEK_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		const [fromText, toText] = positionals;
		if (values.last && fromText !== undefined) {
			throw new UsageError("Pass --last or the weeks, not both.");
		}
		const { session, scope } = await openOrg(runtime, out, values.org);
		const weekStartsOn = scope.clock.weekStartsOn;
		const thisWeek = startOfWeekKey(todayKey(scope.clock), weekStartsOn);

		let toWeekStart = values.last ? addDaysToKey(thisWeek, -7) : thisWeek;
		let fromWeekStart = addDaysToKey(toWeekStart, -7);
		if (fromText !== undefined) {
			fromWeekStart = startOfWeekKey(
				parseDay(fromText, scope.clock),
				weekStartsOn,
			);
			toWeekStart = toText
				? startOfWeekKey(parseDay(toText, scope.clock), weekStartsOn)
				: thisWeek;
		}
		if (fromWeekStart === toWeekStart) {
			throw new UsageError("A week cannot be copied onto itself.");
		}
		const result = await session.api.post<ApiCopyResult, CopyWeekEntriesInput>(
			scope.path("/time-entries/copy-week"),
			{ fromWeekStart, toWeekStart },
		);
		reportCopy(
			out.json,
			result,
			`from the week of ${fromWeekStart} to the week of ${toWeekStart}`,
		);
	},
};

const OFF_USAGE = "farmer off <task> [<from>[..<to>]] [-m text]";

export const off: Command = {
	name: "off",
	usage: OFF_USAGE,
	summary: "Book time off for a day or a span. The default is today.",
	help: [
		"  <task>          An absence task: vacation, sick leave, paid leave.",
		"  <from>..<to>    A span, for example 2026-12-22..2027-01-02.",
		"  -m, --message   A note.",
		"",
		"Weekends, public holidays and your days off are skipped.",
	],
	run: async (args, runtime) => {
		const { values, positionals } = parseCommandArgs(
			args,
			{ message: { type: "string", short: "m" } },
			2,
			OFF_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		const [taskQuery, spanText] = positionals;
		const { session, scope } = await openOrg(runtime, out, values.org);
		const span = parseDaySpan(spanText ?? "today", scope.clock);
		const taskList = await session.api.get<ApiTaskList>(scope.path("/tasks"));
		const task = await chooseTask(
			out,
			taskList.absenceTasks,
			taskQuery,
			"<task>",
		);

		const body: LogAbsenceRangeInput = {
			taskId: task.id,
			from: span.from,
			to: span.to,
		};
		if (values.message) body.description = values.message;
		const result = await session.api.post<
			ApiAbsenceResult,
			LogAbsenceRangeInput
		>(scope.path("/absences"), body);

		if (out.json) {
			printJson(result);
			return;
		}
		if (result.booked.length === 0 && result.skipped.length === 0) {
			throw new CliError("The server booked nothing.");
		}
		const bookedSeconds = result.booked.reduce(
			(sum, day) => sum + day.durationSeconds,
			0,
		);
		print(bold(out, `${task.name}, ${spanTitle(span)}`));
		printTable(out, {
			columns: [
				{ header: "Date" },
				{ header: "Time", align: "right" },
				{ header: "Note", shrink: true },
			],
			rows: [
				...result.booked.map((day) => [
					dayTitle(day.date),
					formatHours(day.durationSeconds),
					"booked",
				]),
				...result.skipped.map((day) => [dayTitle(day.date), "-", day.reason]),
			].sort((a, b) =>
				(a[0] ?? "").slice(4).localeCompare((b[0] ?? "").slice(4)),
			),
			total: [
				"Total",
				formatHours(bookedSeconds),
				plural(result.booked.length, "day"),
			],
		});
	},
};
