import type {
	ApiDeleted,
	ApiProject,
	ApiTaskList,
	ApiTimeEntry,
} from "@farmer/core/api";
import { formatDurationInput } from "@farmer/core/lib/time";
import { addDaysToKey } from "@farmer/core/lib/time";
import {
	type CreateTimeEntryInput,
	listTimeEntriesRangeInput,
} from "@farmer/core/schema";

import { type DaySpan, parseDay, todayKey, weekAround } from "../dates";
import { formatHours, parseQuarterHours } from "../duration";
import { CancelledError, UsageError } from "../errors";
import {
	bold,
	createOutput,
	note,
	type Output,
	print,
	printJson,
	say,
} from "../output";
import {
	chooseProject,
	chooseProjectOrNone,
	chooseTask,
	selectEntry,
} from "../pick";
import { askConfirm, askText, requireInteractive } from "../prompts";
import {
	dayTitle,
	entriesTable,
	entryWhat,
	printTable,
	shortId,
	spanTitle,
} from "../render";
import { defaultRow, defaultsNotice } from "../repository-defaults";
import { openOrg, type OrgScope, type Session } from "../session";
import { type Command, parseCommandArgs } from "./command";

/** The fields `PATCH …/time-entries/$id` takes. Every one is optional, and an
 *  absent one is left as it is. */
type TimeEntryPatch = Partial<
	Pick<
		CreateTimeEntryInput,
		| "date"
		| "projectId"
		| "taskId"
		| "description"
		| "durationSeconds"
		| "overtime"
		| "fillsDay"
	>
>;

const checkRange = (span: DaySpan) => {
	// The server holds the same ceiling; checking it here first answers with the
	// schema's own sentence before a request is spent on it.
	const parsed = listTimeEntriesRangeInput.safeParse(span);
	if (!parsed.success) {
		throw new UsageError(
			parsed.error.issues.map((issue) => issue.message).join("\n"),
		);
	}
};

export const listEntries = (session: Session, scope: OrgScope, span: DaySpan) =>
	session.api.get<ApiTimeEntry[]>(
		scope.path(`/time-entries?${new URLSearchParams(span)}`),
	);

const showEntries = async (
	out: Output,
	session: Session,
	scope: OrgScope,
	span: DaySpan,
) => {
	checkRange(span);
	const entries = await listEntries(session, scope, span);
	if (out.json) {
		printJson(entries);
		return;
	}
	print(bold(out, spanTitle(span)));
	if (entries.length === 0) {
		print("No time logged.");
		return;
	}
	printTable(out, entriesTable(entries, span.from !== span.to));
};

const TODAY_USAGE = "farmer today";

export const today: Command = {
	name: "today",
	usage: TODAY_USAGE,
	summary: "List today's entries.",
	help: [
		"Do not run this under `watch`: reading a day can recompute its",
		"rest-of-day block on the server.",
	],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(args, {}, 0, TODAY_USAGE);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope } = await openOrg(runtime, out, values.org);
		const day = todayKey(scope.clock);
		await showEntries(out, session, scope, { from: day, to: day });
	},
};

const WEEK_USAGE = "farmer week [--last]";

export const week: Command = {
	name: "week",
	usage: WEEK_USAGE,
	summary: "List this week's entries, as the organization starts the week.",
	help: ["  --last        Last week instead."],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(
			args,
			{ last: { type: "boolean" } },
			0,
			WEEK_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope } = await openOrg(runtime, out, values.org);
		const day = todayKey(scope.clock);
		const span = weekAround(
			values.last ? addDaysToKey(day, -7) : day,
			scope.clock.weekStartsOn,
		);
		await showEntries(out, session, scope, span);
	},
};

const LS_USAGE = "farmer ls [date] [--from <date>] [--to <date>]";

export const ls: Command = {
	name: "ls",
	usage: LS_USAGE,
	summary: "List the entries of a day or a range. The default is today.",
	help: [
		"  [date]          One day.",
		"  --from <date>   The first day. Without --to, the range ends today.",
		"  --to <date>     The last day. Without --from, the range is that day.",
		"",
		"A range is at most 62 days.",
	],
	run: async (args, runtime) => {
		const { values, positionals } = parseCommandArgs(
			args,
			{ from: { type: "string" }, to: { type: "string" } },
			1,
			LS_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		const [day] = positionals;
		if (day !== undefined && (values.from || values.to)) {
			throw new UsageError(
				`Pass a date or --from/--to, not both.\nUsage: ${LS_USAGE}`,
			);
		}
		const { session, scope } = await openOrg(runtime, out, values.org);
		const now = todayKey(scope.clock);

		let span: DaySpan;
		if (day !== undefined) {
			const key = parseDay(day, scope.clock);
			span = { from: key, to: key };
		} else if (values.from !== undefined) {
			const from = parseDay(values.from, scope.clock);
			const to =
				values.to !== undefined
					? parseDay(values.to, scope.clock)
					: from <= now
						? now
						: from;
			span = { from, to };
		} else if (values.to !== undefined) {
			const to = parseDay(values.to, scope.clock);
			span = { from: to, to };
		} else {
			span = { from: now, to: now };
		}
		await showEntries(out, session, scope, span);
	},
};

const LOG_USAGE =
	"farmer log <duration | fill> [description] [-p project] [-t task] [-d date] [--overtime]";

export const log: Command = {
	name: "log",
	usage: LOG_USAGE,
	summary: "Log time. The default day is today.",
	help: [
		"  <duration>        1h30m, 1.5 or 90m, in 15-minute steps.",
		"  fill              Fill the rest of the working day.",
		"  [description]     What you worked on. Quotes are optional.",
		"  -p, --project     A project name, code or client. `none` for no project.",
		"                    The default is `project` in .farmer.jsonc.",
		"  -t, --task        A task name. The default is `task` in .farmer.jsonc.",
		"  -d, --date        today, yesterday, a weekday name, or yyyy-MM-dd.",
		"  --overtime        Mark the entry as overtime.",
		"",
		"A missing -p or -t with no default opens a searchable list.",
		"`farmer init` writes .farmer.jsonc; `farmer whoami` shows what it names.",
	],
	run: async (args, runtime) => {
		const { values, positionals } = parseCommandArgs(
			args,
			{
				project: { type: "string", short: "p" },
				task: { type: "string", short: "t" },
				date: { type: "string", short: "d" },
				overtime: { type: "boolean" },
			},
			Number.POSITIVE_INFINITY,
			LOG_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		const [amountArg, ...words] = positionals;
		let amount = amountArg;
		if (amount === undefined) {
			requireInteractive(out, `Say how long, or "fill".\nUsage: ${LOG_USAGE}`);
			amount = await askText("How long?", undefined, "1h30m, 1.5, 90m or fill");
		}
		const fill = amount.trim().toLowerCase() === "fill";
		// Read before any request, so a typo costs nothing.
		const seconds = fill ? null : parseQuarterHours(amount);

		const { session, scope, defaults } = await openOrg(
			runtime,
			out,
			values.org,
			{ announce: false },
		);
		const date = parseDay(values.date ?? "today", scope.clock);
		const [projects, taskList] = await Promise.all([
			session.api.get<ApiProject[]>(scope.path("/projects")),
			session.api.get<ApiTaskList>(scope.path("/tasks")),
		]);

		// A flag wins; the file fills what the flags left out, and says so before
		// a picker opens for anything it did not fill.
		const projectDefault =
			defaults && values.project === undefined
				? defaultRow(projects, defaults.project, defaults, "project", "-p")
				: undefined;
		const taskDefault =
			defaults?.task !== undefined && values.task === undefined
				? defaultRow(taskList.tasks, defaults.task, defaults, "task", "-t")
				: undefined;
		if (defaults) {
			note(
				defaultsNotice(defaults.shown, [
					`organization ${scope.slug}`,
					...(projectDefault ? [`project ${projectDefault.name}`] : []),
					...(taskDefault ? [`task ${taskDefault.name}`] : []),
				]),
			);
		}
		const project =
			projectDefault ??
			(await chooseProjectOrNone(out, projects, values.project));
		const task =
			taskDefault ?? (await chooseTask(out, taskList.tasks, values.task, "-t"));

		let description = words.join(" ").trim();
		if (!description && amountArg === undefined && out.interactive) {
			description = (
				await askText(
					"What did you work on?",
					undefined,
					"Leave empty for a Break",
				)
			).trim();
		}

		const body: CreateTimeEntryInput = {
			date,
			taskId: task.id,
			overtime: values.overtime === true,
			fillsDay: fill,
		};
		if (project) body.projectId = project.id;
		if (description) body.description = description;
		if (seconds !== null) body.durationSeconds = seconds;

		const entry = await session.api.post<ApiTimeEntry, CreateTimeEntryInput>(
			scope.path("/time-entries"),
			body,
		);
		if (out.json) {
			printJson(entry);
			return;
		}
		print(
			fill
				? `Filled the rest of ${dayTitle(entry.date)} with ${bold(out, formatHours(entry.durationSeconds))} on ${entryWhat(entry)}. (${shortId(entry.id)})`
				: `Logged ${bold(out, formatHours(entry.durationSeconds))} on ${entryWhat(entry)} for ${dayTitle(entry.date)}. (${shortId(entry.id)})`,
		);
	},
};

const EDIT_USAGE =
	"farmer edit [id] [-d date] [--duration <d>] [-m text] [-p project] [-t task] [--move <date>] [--overtime | --no-overtime]";

export const edit: Command = {
	name: "edit",
	usage: EDIT_USAGE,
	summary: "Change an entry. Without an id, choose one of the day's entries.",
	help: [
		"  [id]              The id or its first characters, as the lists show it.",
		"  -d, --date        The day to find the entry on. The default is today.",
		"  --duration <d>    A new duration, or `fill`.",
		"  -m, --message     A new description.",
		"  -p, --project     A new project.",
		"  -t, --task        A new task.",
		"  --move <date>     Move the entry to another day.",
		"  --overtime        Mark as overtime. --no-overtime removes the mark.",
		"",
		"With no change flags, farmer asks for the duration and the description.",
	],
	run: async (args, runtime) => {
		const { values, positionals } = parseCommandArgs(
			args,
			{
				date: { type: "string", short: "d" },
				duration: { type: "string" },
				message: { type: "string", short: "m" },
				project: { type: "string", short: "p" },
				task: { type: "string", short: "t" },
				move: { type: "string" },
				overtime: { type: "boolean" },
				"no-overtime": { type: "boolean" },
			},
			1,
			EDIT_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		if (values.overtime && values["no-overtime"]) {
			throw new UsageError("Pass --overtime or --no-overtime, not both.");
		}

		const patch: TimeEntryPatch = {};
		if (values.duration !== undefined) {
			if (values.duration.trim().toLowerCase() === "fill") {
				patch.fillsDay = true;
			} else {
				patch.durationSeconds = parseQuarterHours(values.duration);
				patch.fillsDay = false;
			}
		}
		if (values.message !== undefined) patch.description = values.message;
		if (values.overtime) patch.overtime = true;
		if (values["no-overtime"]) patch.overtime = false;

		const { session, scope } = await openOrg(runtime, out, values.org);
		const day = parseDay(values.date ?? "today", scope.clock);
		if (values.move !== undefined) {
			patch.date = parseDay(values.move, scope.clock);
		}
		if (values.project !== undefined) {
			const projects = await session.api.get<ApiProject[]>(
				scope.path("/projects"),
			);
			patch.projectId = (await chooseProject(out, projects, values.project)).id;
		}
		if (values.task !== undefined) {
			const taskList = await session.api.get<ApiTaskList>(scope.path("/tasks"));
			patch.taskId = (
				await chooseTask(out, taskList.tasks, values.task, "-t")
			).id;
		}

		const entries = await listEntries(session, scope, { from: day, to: day });
		const { id, entry } = await selectEntry(
			out,
			entries,
			positionals[0],
			day,
			"edit",
		);

		if (Object.keys(patch).length === 0) {
			if (!entry) {
				throw new UsageError(
					`Say what to change: --duration, -m, -p, -t, --move or --overtime.\nUsage: ${EDIT_USAGE}`,
				);
			}
			requireInteractive(
				out,
				`Say what to change: --duration, -m, -p, -t, --move or --overtime.\nUsage: ${EDIT_USAGE}`,
			);
			const current = entry.fillsDay
				? "fill"
				: formatDurationInput(entry.durationSeconds);
			const duration = (await askText("Duration", current)).trim();
			if (duration && duration !== current) {
				if (duration.toLowerCase() === "fill") patch.fillsDay = true;
				else {
					patch.durationSeconds = parseQuarterHours(duration);
					patch.fillsDay = false;
				}
			}
			const description = await askText("Description", entry.description);
			if (description !== entry.description) {
				patch.description = description;
			}
		}

		if (Object.keys(patch).length === 0) {
			if (out.json) printJson(entry);
			else print("Nothing changed.");
			return;
		}

		const updated = await session.api.patch<ApiTimeEntry, TimeEntryPatch>(
			scope.path(`/time-entries/${id}`),
			patch,
		);
		if (out.json) printJson(updated);
		else {
			print(
				`Updated ${shortId(updated.id)}: ${bold(out, formatHours(updated.durationSeconds))} on ${entryWhat(updated)} for ${dayTitle(updated.date)}.`,
			);
		}
	},
};

const RM_USAGE = "farmer rm [id] [-d date] [--yes]";

export const rm: Command = {
	name: "rm",
	usage: RM_USAGE,
	summary: "Delete an entry. Without an id, choose one of the day's entries.",
	help: [
		"  [id]          The id or its first characters, as the lists show it.",
		"  -d, --date    The day to find the entry on. The default is today.",
		"  -y, --yes     Delete without asking.",
	],
	run: async (args, runtime) => {
		const { values, positionals } = parseCommandArgs(
			args,
			{
				date: { type: "string", short: "d" },
				yes: { type: "boolean", short: "y" },
			},
			1,
			RM_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope } = await openOrg(runtime, out, values.org);
		const day = parseDay(values.date ?? "today", scope.clock);
		const entries = await listEntries(session, scope, { from: day, to: day });
		const { id, entry } = await selectEntry(
			out,
			entries,
			positionals[0],
			day,
			"delete",
		);

		const what = entry
			? `${formatHours(entry.durationSeconds)} on ${entryWhat(entry)} (${dayTitle(entry.date)})`
			: `the entry ${id}`;
		if (!values.yes) {
			requireInteractive(out, "Pass --yes to delete without a question.");
			if (!(await askConfirm(`Delete ${what}?`))) throw new CancelledError();
		}

		// Time off is removed through its own route, which re-checks the rules
		// that booked it (a PM's correction, a span that skipped holidays).
		const path = entry?.task.isAbsence
			? `/absences/${id}`
			: `/time-entries/${id}`;
		const deleted = await session.api.delete<ApiDeleted>(scope.path(path));
		if (out.json) printJson(deleted);
		else say(out, `Deleted ${what}.`);
	},
};
