import type {
	ApiProject,
	ApiTaskList,
	ApiTimeEntry,
	ApiTimer,
	ApiTimerState,
} from "@farmer/core/api";
import type { ConfirmTimerInput, StartTimerInput } from "@farmer/core/schema";

import { parseDay } from "../dates";
import {
	addToDuration,
	formatHours,
	parseHeadStart,
	parseQuarterHours,
} from "../duration";
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
import { chooseProjectOrNone, chooseTask, selectEntry } from "../pick";
import { askConfirm, askText, requireInteractive } from "../prompts";
import { dayTitle, entryWhat, shortId } from "../render";
import { defaultRow, defaultsNotice } from "../repository-defaults";
import { openOrg, type OrgScope, type Session } from "../session";
import { type Command, parseCommandArgs } from "./command";
import { listEntries } from "./entries";

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
		`${bold(out, stopwatch(timer.elapsedSeconds))} on ${whatItMeasures(timer)}${timer.paused ? ", held" : ""}.`,
	);
	if (timer.entry) {
		print(
			`It adds to the entry on ${dayTitle(timer.entry.date)} (${shortId(timer.entry.id)}), which held ${formatHours(timer.entry.durationSeconds)}.`,
		);
	}
	print(
		timer.paused
			? `The clock is held, so this figure stands still. Resume it with \`farmer resume\`, or stop it to log ${formatHours(timer.snappedSeconds)}.`
			: `Stopping now logs ${formatHours(timer.snappedSeconds)}, in 15-minute steps as every entry is.`,
	);
};

/**
 * `farmer pause` and `farmer resume` — one shape, two verbs.
 *
 * Both routes answer a timer that is already in the state asked for with the
 * row as it stands, rather than an error, so a terminal that repeats itself
 * says the same thing twice instead of failing the second time.
 */
const hold = (
	name: "pause" | "resume",
	summary: string,
	help: string[],
	said: (out: Output, timer: ApiTimer) => string,
): Command => ({
	name,
	usage: `farmer ${name}`,
	summary,
	help,
	run: async (args, runtime) => {
		const { values } = parseCommandArgs(args, {}, 0, `farmer ${name}`);
		const out = createOutput(values.json === true, runtime.env);
		const { session, scope } = await openOrg(runtime, out, values.org, {
			announce: false,
		});
		const running = await readTimer(session, scope);
		if (!running) {
			throw new CliError("No timer is running. Start one with `farmer start`.");
		}
		if (running.droppedAt) {
			throw new CliError(
				"Your timer was dropped for running past your limit. Run `farmer timer discard` to clear it.",
			);
		}
		if (!running.organization.here) {
			throw new CliError(
				`That timer is running in ${running.organization.name}. Run \`farmer ${name} --org ${running.organization.slug}\`.`,
			);
		}

		const state = await session.api.post<ApiTimerState, Record<string, never>>(
			scope.path(`/timer/${name}`),
			{},
		);
		const timer = state.timer;
		if (!timer) throw new CliError("The server answered with no timer.");

		if (out.json) printJson(timer);
		else say(out, said(out, timer));
	},
});

export const pause = hold(
	"pause",
	"Hold the timer. It keeps its figure and measures nothing.",
	[
		"A held timer may be held for as long as you want: it measures nothing,",
		"so it can never run past your limit and be dropped. `farmer resume`",
		"starts it measuring again.",
	],
	(out, timer) =>
		`Held at ${bold(out, stopwatch(timer.elapsedSeconds))} on ${whatItMeasures(timer)}. Resume it with \`farmer resume\`.`,
);

export const resume = hold(
	"resume",
	"Start a held timer measuring again.",
	["`farmer pause` holds it."],
	(out, timer) =>
		`Measuring again from ${bold(out, stopwatch(timer.elapsedSeconds))} on ${whatItMeasures(timer)}.`,
);

/** Posts a start, and says what the server started. `farmer start` and
 *  `farmer continue` differ only in the body. */
const postStart = async (
	session: Session,
	scope: OrgScope,
	out: Output,
	body: StartTimerInput,
) => {
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
	const from =
		timer.elapsedSeconds > 0 ? ` from ${stopwatch(timer.elapsedSeconds)}` : "";
	say(
		out,
		`Timing ${whatItMeasures(timer)}${from}. Stop it with \`farmer stop\`.`,
	);
};

const HEAD_START_HELP = [
	"  --head-start <d>  Time you already worked before you started the timer,",
	"                    for example 20m. It counts towards your timer limit.",
];

const START_USAGE =
	"farmer start [description] [-p project] [-t task] [--head-start <d>]";

export const start: Command = {
	name: "start",
	usage: START_USAGE,
	summary: "Start the timer. Stop it with `farmer stop`.",
	help: [
		"  [description]     What you are working on. Quotes are optional.",
		"  -p, --project     A project name, code or client. `none` for no project.",
		"                    The default is `project` in .farmer.jsonc.",
		"  -t, --task        A task name. The default is `task` in .farmer.jsonc.",
		...HEAD_START_HELP,
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
				"head-start": { type: "string" },
			},
			Number.POSITIVE_INFINITY,
			START_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		// Read before any request, so a typo costs nothing.
		const headStart =
			values["head-start"] === undefined
				? null
				: parseHeadStart(values["head-start"]);
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
		if (headStart !== null) body.headStartSeconds = headStart;

		await postStart(session, scope, out, body);
	},
};

const CONTINUE_USAGE = "farmer continue [n | id] [-d date] [--head-start <d>]";

/**
 * Why the server would refuse to continue an entry, said before anything is
 * posted: a work-time block's length is recomputed from the day, and would
 * overwrite the clock, and time off is booked as a span rather than measured.
 * `timersService.start` refuses both as well — this only saves the round trip,
 * and keeps the picker from offering them.
 */
export const whyNotContinued = (entry: ApiTimeEntry): string | null => {
	if (entry.fillsDay) {
		return "That entry is a work-time block. It fills whatever the day has left, so a timer cannot continue it.";
	}
	if (entry.task.isAbsence) {
		return `That entry is time off (${entry.task.name}). Time off is booked as a span, not measured by a timer.`;
	}
	return null;
};

/**
 * `farmer continue` (issue #107): start the timer on an entry that already
 * exists, the way Harvest restarts a row. The timer takes the entry's project,
 * task and note, measures on top of what it holds, and `farmer stop` saves
 * over that entry instead of logging a new one.
 */
export const continueEntry: Command = {
	name: "continue",
	usage: CONTINUE_USAGE,
	summary: "Start the timer on an entry, adding to its time.",
	help: [
		"  [n | id]          The row number in the day, as the lists show it, or",
		"                    the id or its first characters. Without it, choose.",
		"  -d, --date        The day to find the entry on. The default is today.",
		...HEAD_START_HELP,
		"",
		"`farmer stop` saves the total over the entry, on the entry's own day.",
		"A work-time block and time off cannot be continued.",
	],
	run: async (args, runtime) => {
		const { values, positionals } = parseCommandArgs(
			args,
			{
				date: { type: "string", short: "d" },
				"head-start": { type: "string" },
			},
			1,
			CONTINUE_USAGE,
		);
		const out = createOutput(values.json === true, runtime.env);
		const headStart =
			values["head-start"] === undefined
				? null
				: parseHeadStart(values["head-start"]);

		const { session, scope } = await openOrg(runtime, out, values.org, {
			announce: false,
		});
		const day = parseDay(values.date ?? "today", scope.clock);
		const entries = await listEntries(session, scope, { from: day, to: day });
		const { id } = await selectEntry(
			out,
			entries,
			positionals[0],
			day,
			"continue",
			whyNotContinued,
		);

		const body: StartTimerInput = { timeEntryId: id };
		if (headStart !== null) body.headStartSeconds = headStart;

		await postStart(session, scope, out, body);
	},
};

/**
 * The measured part `farmer stop` sends as `measuredSeconds`. The server adds
 * the hours the entry holds when it saves, so an edit made to the entry while
 * the command waited at its prompt is kept.
 *
 * A typed `--duration` is the time this timer stands for, never the entry's
 * total: on a timer that continues an entry it is added to what the entry held,
 * the way `farmer edit --add` adds. That meaning is unchanged, so a typed
 * figure is sent as the measured part. A sum past a day is refused here, from
 * the hours as read, and again by the server from the live hours.
 */
export const stoppedMeasured = (
	timer: Pick<ApiTimer, "snappedSeconds" | "entry">,
	typed: string | undefined,
): number => {
	if (typed === undefined) {
		return Math.max(
			0,
			timer.snappedSeconds - (timer.entry?.durationSeconds ?? 0),
		);
	}
	if (timer.entry) addToDuration(timer.entry.durationSeconds, typed);
	return parseQuarterHours(typed);
};

/**
 * The note `farmer stop` sends, or undefined to leave the live one alone.
 *
 * The timer's note was read before the prompt, and the person may have edited
 * the entry's note on the web while the command waited. So the read note is
 * never sent back as it was. `-m` is sent. A prompt answer is sent only when it
 * differs from the default the prompt offered. An emptied answer differs, so ""
 * still clears the note. A script without `-m` sends nothing.
 */
export const stoppedNote = ({
	message,
	answer,
	read,
}: {
	message: string | undefined;
	answer: string | undefined;
	read: string;
}): string | undefined => {
	if (message !== undefined) return message;
	if (answer === undefined) return undefined;
	return answer.trim() === read.trim() ? undefined : answer.trim();
};

const STOP_USAGE =
	"farmer stop [-m text] [-p project] [-t task] [--duration <d>] [-d date] [--overtime]";

export const stop: Command = {
	name: "stop",
	usage: STOP_USAGE,
	summary: "Stop the timer and log the time it measured.",
	help: [
		"  -m, --message     What you worked on. Without it, farmer asks at a",
		"                    terminal, offering the timer's own note.",
		"  -p, --project     Log against this project instead of the timer's.",
		"  -t, --task        Log against this task instead of the timer's.",
		"  --duration <d>    Log this instead of the measured time, in 15-minute",
		"                    steps. On a timer that continues an entry, this is",
		"                    added to what the entry held, as `farmer edit --add`.",
		"  -d, --date        Log on this day instead of the day the timer started,",
		"                    or the day of the entry it continues.",
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
			measuredSeconds: stoppedMeasured(timer, values.duration),
			overtime: values.overtime === true,
		};
		if (values.date !== undefined) {
			body.date = parseDay(values.date, scope.clock);
		}
		// The timer's own day, project and task are left out, so the server
		// keeps the live ones: a continued entry stays on its own day unless -d
		// moves it. The note is left out too, unless -m or the prompt gives one.

		if (values.project !== undefined) {
			const projects = await session.api.get<ApiProject[]>(
				scope.path("/projects"),
			);
			const chosen = await chooseProjectOrNone(out, projects, values.project);
			// Null, not absent: on a continued entry an absent project keeps the
			// entry's own, and `-p none` asks to clear it.
			body.projectId = chosen ? chosen.id : null;
		}
		if (values.task !== undefined) {
			const taskList = await session.api.get<ApiTaskList>(scope.path("/tasks"));
			body.taskId = (
				await chooseTask(out, taskList.tasks, values.task, "-t")
			).id;
		}
		// The note. `-m` answers it, and the timer's own note is the default; with
		// neither, ask, because the task this timer is on usually requires one and
		// a refusal after the fact costs the person the command. Nothing is asked
		// where nobody can answer: a script gets the server's sentence, which
		// names what is missing.
		//
		// `needsDescription` is the timer's own task. A `-t` override logs against
		// another one, whose rule this binary cannot read, so the answer is
		// optional there and the server stays the authority.
		let answer: string | undefined;
		if (values.message === undefined && out.interactive) {
			const needed = timer.task.needsDescription && values.task === undefined;
			answer = await askText(
				"What did you work on?",
				timer.description,
				needed ? `Required on ${timer.task.name}` : "Optional",
				(value) =>
					needed && !value?.trim()
						? `${timer.task.name} needs a note. Type one, or stop with -m.`
						: undefined,
			);
		}
		const note = stoppedNote({
			message: values.message,
			answer,
			read: timer.description,
		});
		if (note !== undefined) body.description = note;

		const entry = await session.api.post<ApiTimeEntry, ConfirmTimerInput>(
			scope.path("/timer/confirm"),
			body,
		);
		if (out.json) {
			printJson(entry);
			return;
		}
		// `elapsedSeconds` of a continued entry includes the hours the entry
		// already held, so the clock's own figure is what is left after them.
		const clock = stopwatch(
			timer.elapsedSeconds - (timer.entry?.durationSeconds ?? 0),
		);
		const measured = timer.entry
			? typed === null
				? `Measured ${clock} on top of the ${formatHours(timer.entry.durationSeconds)} it held. Updated the entry to`
				: `Measured ${clock}, and added ${formatHours(typed)} to the ${formatHours(timer.entry.durationSeconds)} it held. Updated the entry to`
			: `Measured ${clock}. Logged`;
		print(
			`${measured} ${bold(out, formatHours(entry.durationSeconds))} on ${entryWhat(entry)} for ${dayTitle(entry.date)}. (${shortId(entry.id)})`,
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
