import type {
	ApiProject,
	ApiTaskList,
	ApiTimeEntry,
	ApiTimer,
	ApiTimerState,
} from "@farmer/core/api";
import { dayKeyInTz } from "@farmer/core/lib/time";
import type { ConfirmTimerInput, StartTimerInput } from "@farmer/core/schema";

import { parseDay } from "../dates";
import { formatHours, parseQuarterHours } from "../duration";
import { CancelledError, CliError } from "../errors";
import {
	bold,
	createOutput,
	note,
	type Output,
	print,
	printJson,
	say,
} from "../output";
import { chooseProjectOrNone, chooseTask } from "../pick";
import { askConfirm, requireInteractive } from "../prompts";
import { dayTitle, entryWhat, shortId } from "../render";
import { defaultRow, defaultsNotice } from "../repository-defaults";
import { openOrg, type OrgScope, type Session } from "../session";
import { type Command, parseCommandArgs } from "./command";

/**
 * The stopwatch (issue #43), the same one the web app drives (issue #59).
 *
 * The timer is a row on the server keyed on the PERSON, so `farmer start` in a
 * terminal and Stop in a browser are the same clock. Nothing is written while
 * it runs: `farmer stop` logs the measured time, snapped to the 15-minute step
 * every entry keeps, and a timer nobody stopped is dropped and logs nothing.
 */

/** `H:MM:SS`. A stopwatch shows its seconds; `formatHours` is for durations
 *  that were logged, and those are always quarter hours. */
const stopwatch = (totalSeconds: number): string => {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

/**
 * A 404 with no `code` is a route this server does not have.
 *
 * Every organization route answers a JSON 404 WITH a code when the CLI is
 * switched off, so the code is what tells "your Farmer is older than your
 * farmer" from "the administrator turned this off".
 */
const timerUnsupported = (error: CliError, origin: string): CliError =>
	error.status === 404 && !error.code
		? new CliError(
				`${origin} does not have timers yet. Ask the administrator to update it.`,
			)
		: error;

const readTimer = async (
	session: Session,
	scope: OrgScope,
): Promise<ApiTimer | null> => {
	try {
		const state = await session.api.get<ApiTimerState>(scope.path("/timer"));
		return state.timer;
	} catch (error) {
		if (error instanceof CliError) {
			throw timerUnsupported(error, session.server.origin);
		}
		throw error;
	}
};

const whatItMeasures = (timer: ApiTimer): string => {
	const where = timer.project ? `${timer.project.name} / ` : "";
	const said = timer.description ? ` — ${timer.description}` : "";
	return `${where}${timer.task.name}${said}`;
};

/** The one paragraph every command here prints about a running timer. */
const describeTimer = (out: Output, timer: ApiTimer) => {
	if (timer.droppedAt) {
		print(
			`Your timer on ${whatItMeasures(timer)} ran past your limit and was dropped. Nothing was logged.`,
		);
		print(
			`It started ${timer.startedAt}. Log the time with \`farmer log\`, then run \`farmer timer discard\` to clear this.`,
		);
		return;
	}
	if (!timer.organization.here) {
		print(
			`A timer is running in ${timer.organization.name}: ${bold(out, stopwatch(timer.elapsedSeconds))} on ${whatItMeasures(timer)}.`,
		);
		print(`Stop it with \`farmer stop --org ${timer.organization.slug}\`.`);
		return;
	}
	print(
		`${bold(out, stopwatch(timer.elapsedSeconds))} on ${whatItMeasures(timer)}.`,
	);
	print(
		`Stopping now logs ${formatHours(timer.snappedSeconds)}, in 15-minute steps as every entry is.`,
	);
};

const START_USAGE = "farmer start [description] [-p project] [-t task]";

export const start: Command = {
	name: "start",
	usage: START_USAGE,
	summary: "Start the timer. Stop it with `farmer stop`.",
	help: [
		"  [description]     What you are working on. Quotes are optional.",
		"  -p, --project     A project name, code or client. `none` for no project.",
		"                    The default is `project` in .farmer.jsonc.",
		"  -t, --task        A task name. The default is `task` in .farmer.jsonc.",
		"",
		"Nothing is logged until you stop the timer, and what is logged is the",
		"measured time in 15-minute steps. One timer at a time, in every",
		"workspace and on every machine.",
	],
	run: async (args, runtime) => {
		const { values, positionals } = parseCommandArgs(
			args,
			{
				project: { type: "string", short: "p" },
				task: { type: "string", short: "t" },
			},
			Number.POSITIVE_INFINITY,
			START_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope, defaults } = await openOrg(
			runtime,
			out,
			values.org,
			{ announce: false },
		);

		const [projects, taskList] = await Promise.all([
			session.api.get<ApiProject[]>(scope.path("/projects")),
			session.api.get<ApiTaskList>(scope.path("/tasks")),
		]);

		// The same order `farmer log` reads them in: a flag wins, the repository
		// file fills what the flags left out, and a picker opens for the rest.
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

		const body: StartTimerInput = { taskId: task.id };
		if (project) body.projectId = project.id;
		const description = positionals.join(" ").trim();
		if (description) body.description = description;

		let state: ApiTimerState;
		try {
			state = await session.api.post<ApiTimerState, StartTimerInput>(
				scope.path("/timer"),
				body,
			);
		} catch (error) {
			if (error instanceof CliError) {
				throw timerUnsupported(error, session.server.origin);
			}
			throw error;
		}
		const timer = state.timer;
		if (!timer) throw new CliError("The server started no timer.");

		if (out.json) {
			printJson(timer);
			return;
		}
		say(out, `Timing ${whatItMeasures(timer)}. Stop it with \`farmer stop\`.`);
	},
};

const STOP_USAGE =
	"farmer stop [-m text] [-p project] [-t task] [--duration <d>] [-d date] [--overtime]";

export const stop: Command = {
	name: "stop",
	usage: STOP_USAGE,
	summary: "Stop the timer and log the time it measured.",
	help: [
		"  -m, --message     What you worked on. The timer's own note is the",
		"                    default.",
		"  -p, --project     Log against this project instead of the timer's.",
		"  -t, --task        Log against this task instead of the timer's.",
		"  --duration <d>    Log this instead of the measured time, in 15-minute",
		"                    steps.",
		"  -d, --date        Log on this day instead of the day the timer started.",
		"  --overtime        Mark the entry as overtime.",
		"",
		"`farmer timer discard` throws a measurement away instead of logging it.",
		"The measured time is rounded to the nearest 15 minutes, which is the",
		"only duration an entry can hold. Pass --duration to log another one.",
	],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(
			args,
			{
				message: { type: "string", short: "m" },
				project: { type: "string", short: "p" },
				task: { type: "string", short: "t" },
				duration: { type: "string" },
				date: { type: "string", short: "d" },
				overtime: { type: "boolean" },
			},
			0,
			STOP_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		// Read before any request, so a typo costs nothing.
		const typed =
			values.duration === undefined ? null : parseQuarterHours(values.duration);

		const { session, scope } = await openOrg(runtime, out, values.org, {
			announce: false,
		});
		const timer = await readTimer(session, scope);
		if (!timer) {
			throw new CliError("No timer is running. Start one with `farmer start`.");
		}
		if (timer.droppedAt) {
			throw new CliError(
				"Your timer was dropped for running past your limit, so it logged nothing. Run `farmer timer discard` to clear it, and `farmer log` to put the time in.",
			);
		}
		if (!timer.organization.here) {
			throw new CliError(
				`That timer is running in ${timer.organization.name}. Run \`farmer stop --org ${timer.organization.slug}\`.`,
			);
		}

		const body: ConfirmTimerInput = {
			date:
				values.date === undefined
					? dayKeyInTz(new Date(timer.startedAt), scope.clock.timeZone)
					: parseDay(values.date, scope.clock),
			taskId: timer.task.id,
			durationSeconds: typed ?? timer.snappedSeconds,
			overtime: values.overtime === true,
		};
		if (timer.project) body.projectId = timer.project.id;
		if (timer.description) body.description = timer.description;

		if (values.project !== undefined) {
			const projects = await session.api.get<ApiProject[]>(
				scope.path("/projects"),
			);
			const chosen = await chooseProjectOrNone(out, projects, values.project);
			if (chosen) body.projectId = chosen.id;
			else body.projectId = undefined;
		}
		if (values.task !== undefined) {
			const taskList = await session.api.get<ApiTaskList>(scope.path("/tasks"));
			body.taskId = (
				await chooseTask(out, taskList.tasks, values.task, "-t")
			).id;
		}
		if (values.message !== undefined) body.description = values.message;

		const entry = await session.api.post<ApiTimeEntry, ConfirmTimerInput>(
			scope.path("/timer/confirm"),
			body,
		);
		if (out.json) {
			printJson(entry);
			return;
		}
		print(
			`Measured ${stopwatch(timer.elapsedSeconds)}. Logged ${bold(out, formatHours(entry.durationSeconds))} on ${entryWhat(entry)} for ${dayTitle(entry.date)}. (${shortId(entry.id)})`,
		);
	},
};

const TIMER_USAGE = "farmer timer";

export const timer: Command = {
	name: "timer",
	usage: TIMER_USAGE,
	summary: "Show what the timer is measuring.",
	help: [
		"A timer belongs to you rather than to a workspace, so this reports one",
		"running in another workspace as well.",
	],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(args, {}, 0, TIMER_USAGE);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope } = await openOrg(runtime, out, values.org, {
			announce: false,
		});
		const running = await readTimer(session, scope);
		if (out.json) {
			printJson({ timer: running });
			return;
		}
		if (!running) {
			print("No timer is running. Start one with `farmer start`.");
			return;
		}
		describeTimer(out, running);
	},
};

const TIMER_DISCARD_USAGE = "farmer timer discard [--yes]";

export const timerDiscard: Command = {
	name: "timer discard",
	usage: TIMER_DISCARD_USAGE,
	summary: "Throw the timer away, or clear a dropped one. Logs nothing.",
	help: ["  -y, --yes     Discard without asking."],
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(
			args,
			{ yes: { type: "boolean", short: "y" } },
			0,
			TIMER_DISCARD_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope } = await openOrg(runtime, out, values.org, {
			announce: false,
		});
		const running = await readTimer(session, scope);
		if (!running) {
			throw new CliError("No timer is running.");
		}

		const what = running.droppedAt
			? `the dropped timer on ${whatItMeasures(running)}`
			: `${stopwatch(running.elapsedSeconds)} on ${whatItMeasures(running)}`;
		if (!values.yes) {
			requireInteractive(out, "Pass --yes to discard without a question.");
			if (!(await askConfirm(`Discard ${what}?`))) throw new CancelledError();
		}

		await session.api.delete<ApiTimerState>(scope.path("/timer"));
		if (out.json) printJson({ discarded: true });
		else say(out, `Discarded ${what}. Nothing was logged.`);
	},
};
