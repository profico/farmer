import type {
	ApiPeriod,
	ApiProject,
	ApiSyncResult,
	ApiTaskList,
	ApiTracking,
} from "@farmer/core/api";

import { openBrowser } from "../browser";
import { formatHours } from "../duration";
import {
	bold,
	createOutput,
	green,
	type Output,
	print,
	printJson,
	red,
	warn,
	yellow,
} from "../output";
import { startProgress } from "../prompts";
import { plural, printTable } from "../render";
import { openOrg } from "../session";
import { type Command, parseCommandArgs } from "./command";

const PROJECTS_USAGE = "farmer projects";

export const projects: Command = {
	name: "projects",
	usage: PROJECTS_USAGE,
	summary: "List the projects you can log time on.",
	help: [],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(args, {}, 0, PROJECTS_USAGE);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope } = await openOrg(runtime, out, values.org);
		const rows = await session.api.get<ApiProject[]>(scope.path("/projects"));
		if (out.json) {
			printJson(rows);
			return;
		}
		printTable(out, {
			columns: [
				{ header: "Name", shrink: true },
				{ header: "Code" },
				{ header: "Client" },
				{ header: "Role" },
				{ header: "ID" },
			],
			rows: rows.map((project) => [
				project.name,
				project.code ?? "",
				project.client.name,
				project.role?.replaceAll("_", " ") ?? "",
				project.id,
			]),
			total: [plural(rows.length, "project"), "", "", "", ""],
		});
	},
};

const TASKS_USAGE = "farmer tasks";

export const tasks: Command = {
	name: "tasks",
	usage: TASKS_USAGE,
	summary: "List the tasks for `farmer log` and the time off for `farmer off`.",
	help: [],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(args, {}, 0, TASKS_USAGE);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope } = await openOrg(runtime, out, values.org);
		const list = await session.api.get<ApiTaskList>(scope.path("/tasks"));
		if (out.json) {
			printJson(list);
			return;
		}
		const all = [...list.tasks, ...list.absenceTasks];
		printTable(out, {
			columns: [
				{ header: "Name" },
				{ header: "Group" },
				{ header: "Use with" },
				{ header: "ID" },
			],
			rows: all.map((task) => [
				task.name,
				task.group,
				task.isAbsence ? "farmer off" : "farmer log",
				task.id,
			]),
			total: [plural(all.length, "task"), "", "", ""],
		});
	},
};

const STATUS_LABELS = {
	on_track: "on track",
	slightly_behind: "slightly behind",
	behind: "behind",
} as const;

const statusText = (out: Output, period: ApiPeriod): string => {
	if (period.status === null) return "no target";
	const label = STATUS_LABELS[period.status];
	if (period.status === "on_track") return green(out, label);
	if (period.status === "slightly_behind") return yellow(out, label);
	return red(out, label);
};

const signedHours = (seconds: number) =>
	seconds < 0 ? `-${formatHours(-seconds)}` : `+${formatHours(seconds)}`;

const STATUS_USAGE = "farmer status";

export const status: Command = {
	name: "status",
	usage: STATUS_USAGE,
	summary: "Show this week and this month against your target.",
	help: [
		"Logged time counts work and time off through today. The target so far",
		"counts the working days before today, and the status compares against",
		"it. The goal today counts today as well.",
	],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(args, {}, 0, STATUS_USAGE);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope } = await openOrg(runtime, out, values.org);
		const tracking = await session.api.get<ApiTracking>(
			scope.path("/tracking"),
		);
		if (out.json) {
			printJson(tracking);
			return;
		}

		const row = (name: string, period: ApiPeriod) => [
			name,
			formatHours(period.totalSoFarSeconds),
			period.targetSoFarSeconds === null
				? "-"
				: formatHours(period.targetSoFarSeconds),
			period.targetSoFarSeconds === null
				? "-"
				: signedHours(period.totalSoFarSeconds - period.targetSoFarSeconds),
			period.targetThroughTodaySeconds === null
				? "-"
				: formatHours(period.targetThroughTodaySeconds),
			period.targetSeconds === null ? "-" : formatHours(period.targetSeconds),
			statusText(out, period),
		];
		printTable(out, {
			columns: [
				{ header: "" },
				{ header: "Logged", align: "right" },
				{ header: "Target so far", align: "right" },
				{ header: "Difference", align: "right" },
				{ header: "Goal today", align: "right" },
				{ header: "Full target", align: "right" },
				{ header: "Status" },
			],
			rows: [row("Week", tracking.week), row("Month", tracking.month)],
			total: null,
		});

		const { month } = tracking;
		print("");
		if (month.status === null || month.targetSoFarSeconds === null) {
			print("No monthly target applies to you.");
		} else if (month.status === "on_track") {
			print(`This month you are ${bold(out, "on track")}.`);
		} else {
			const gap = month.targetSoFarSeconds - month.totalSoFarSeconds;
			print(
				`This month you are ${bold(out, STATUS_LABELS[month.status])}: ${formatHours(gap)} under the target so far (tolerance ${tracking.tolerancePct}%).`,
			);
		}
	},
};

const SYNC_TIMEOUT_MS = 120_000;
const SYNC_USAGE = "farmer sync";

export const sync: Command = {
	name: "sync",
	usage: SYNC_USAGE,
	summary: "Run your calendar, commit and recurring-block sync now.",
	help: [],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(args, {}, 0, SYNC_USAGE);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope } = await openOrg(runtime, out, values.org);
		const progress = startProgress(out, "Syncing");
		let result: ApiSyncResult;
		try {
			result = await session.api.post<ApiSyncResult>(
				scope.path("/sync"),
				undefined,
				SYNC_TIMEOUT_MS,
			);
		} catch (error) {
			progress.fail("The sync did not finish.");
			throw error;
		}

		// Past the request deadline the server answers early and keeps working.
		// The lists are empty then because nothing is known yet, not because
		// nothing ran, so they must not be reported as a result.
		if (result.stillRunning) {
			progress.stop("The sync is still running on the server.");
			if (out.json) printJson(result);
			else print("Run `farmer today` in a minute to see what it added.");
			return;
		}
		progress.stop(
			result.failed.length > 0 ? "Sync finished with errors." : "Synced.",
		);
		if (result.failed.length > 0) process.exitCode = 1;
		if (out.json) {
			printJson(result);
			return;
		}
		const line = (label: string, names: string[]) => {
			if (names.length > 0) print(`${label} ${names.join(", ")}`);
		};
		line("Ran:     ", result.ran);
		line("Skipped: ", result.skipped);
		line("Off:     ", result.off);
		if (result.failed.length > 0) warn(`Failed: ${result.failed.join(", ")}`);
		if (
			result.ran.length + result.skipped.length + result.failed.length ===
			0
		) {
			print(
				"No sync is switched on for you. Turn one on in Settings → Integrations.",
			);
		}
	},
};

const OPEN_USAGE = "farmer open";

export const open: Command = {
	name: "open",
	usage: OPEN_USAGE,
	summary: "Open your timesheet in the browser.",
	help: [],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(args, {}, 0, OPEN_USAGE);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope } = await openOrg(runtime, out, values.org);
		const url = `${session.api.origin}/${encodeURIComponent(scope.slug)}/time`;
		const opened = await openBrowser(url, runtime.platform, runtime.env);
		if (out.json) printJson({ url, opened });
		else print(opened ? `Opened ${url}` : url);
	},
};
