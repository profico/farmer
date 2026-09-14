import { CLI_VERSION } from "../version";
import { login, logout, whoami } from "./auth";
import { type Command, GLOBAL_HELP } from "./command";
import { edit, log, ls, rm, today, week } from "./entries";
import { copyDay, copyWeek, file, off, unfiled } from "./filing";
import { open, projects, status, sync, tasks } from "./info";
import { orgList, orgUse } from "./org";

/** In the order `farmer help` lists them. */
export const COMMANDS: Command[] = [
	login,
	logout,
	whoami,
	orgList,
	orgUse,
	today,
	week,
	ls,
	log,
	edit,
	rm,
	unfiled,
	file,
	copyDay,
	copyWeek,
	off,
	projects,
	tasks,
	status,
	sync,
	open,
];

export type CommandMatch = { command: Command; args: string[] };

/** `org list` before `org`: a two-word command is looked for first. */
export const findCommand = (tokens: string[]): CommandMatch | null => {
	const [first, second] = tokens;
	if (first === undefined) return null;
	if (second !== undefined) {
		const pair = COMMANDS.find(
			(command) => command.name === `${first} ${second}`,
		);
		if (pair) return { command: pair, args: tokens.slice(2) };
	}
	const single = COMMANDS.find((command) => command.name === first);
	return single ? { command: single, args: tokens.slice(1) } : null;
};

/** The subcommands of a group such as `org`, for an incomplete command line. */
export const subcommandsOf = (group: string): Command[] =>
	COMMANDS.filter((command) => command.name.startsWith(`${group} `));

export const mainHelp = (): string => {
	const width = Math.max(...COMMANDS.map((command) => command.name.length));
	return [
		`farmer ${CLI_VERSION} — log and read your time in Farmer.`,
		"",
		"Usage: farmer <command> [options]",
		"",
		"Commands:",
		...COMMANDS.map(
			(command) => `  ${command.name.padEnd(width)}  ${command.summary}`,
		),
		"",
		"Options for every command:",
		...GLOBAL_HELP,
		"",
		"Dates: today, yesterday, a weekday name (the most recent one), yyyy-MM-dd.",
		"Durations: 1h30m, 1.5 or 90m, in 15-minute steps.",
		"",
		"Run `farmer help <command>` for the options of one command.",
		"Run `farmer --version` for the version.",
	].join("\n");
};

export const commandHelp = (command: Command): string =>
	[
		`Usage: ${command.usage}`,
		"",
		command.summary,
		...(command.help.length > 0 ? ["", ...command.help] : []),
		"",
		"Options for every command:",
		...GLOBAL_HELP,
	].join("\n");
