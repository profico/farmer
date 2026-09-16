/**
 * Where the CLI writes, and in what form.
 *
 * Results go to stdout; prompts, spinners and warnings go to stderr. That split
 * is what keeps `farmer today --json | jq` and `farmer log … > file` clean
 * even when the command had to ask a question on the way.
 */

export type Output = {
	/** `--json`: stdout carries the API response and nothing else. */
	json: boolean;
	/** Color on stdout. Off for `NO_COLOR`, a pipe, and `--json`. */
	color: boolean;
	/** A person is at the keyboard, so a missing value can be asked for. */
	interactive: boolean;
	/** stdout is a terminal (not a pipe or a file). */
	stdoutTty: boolean;
	/** Columns of the terminal, or null when stdout is not one. */
	columns: number | null;
};

const ESC = "\u001b";

// no-color.org: the variable counts when it is set to anything but "".
const noColorRequested = (env: NodeJS.ProcessEnv) =>
	(env.NO_COLOR ?? "") !== "";

export const createOutput = (json: boolean, env: NodeJS.ProcessEnv): Output => {
	const stdoutTty = process.stdout.isTTY === true;
	return {
		json,
		color: stdoutTty && !noColorRequested(env) && !json,
		interactive: process.stdin.isTTY === true && process.stderr.isTTY === true,
		stdoutTty,
		columns: stdoutTty ? process.stdout.columns : null,
	};
};

const ansi = (open: number, close: number) => (out: Output, text: string) =>
	out.color ? `${ESC}[${open}m${text}${ESC}[${close}m` : text;

export const bold = ansi(1, 22);
export const dim = ansi(2, 22);
export const green = ansi(32, 39);
export const yellow = ansi(33, 39);
export const red = ansi(31, 39);

export const print = (text: string) => {
	process.stdout.write(`${text}\n`);
};

export const printJson = <T>(value: T) => {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

/** A line for the person, not for a script: silent under `--json`. */
export const say = (out: Output, text: string) => {
	if (!out.json) print(text);
};

// Stderr has its own terminal test: `farmer today | less` still shows a
// colored warning, and `2> log.txt` does not.
const toStderr = (label: string, code: number, text: string) => {
	const colored =
		process.stderr.isTTY === true && !noColorRequested(process.env);
	const prefix = colored ? `${ESC}[${code}m${label}${ESC}[39m` : label;
	process.stderr.write(`${prefix} ${text}\n`);
};

export const warn = (text: string) => toStderr("warning:", 33, text);

export const printError = (text: string) => toStderr("error:", 31, text);

/** Progress lines for the person, on stderr so they never mix into a result. */
export const note = (text: string) => {
	process.stderr.write(`${text}\n`);
};
