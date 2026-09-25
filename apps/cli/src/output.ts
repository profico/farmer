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

/** The SGR codes `ansi` writes, filled as each color below is made. The one
 *  escape sequence `sanitizeForTerminal` lets through. */
const ownCodes = new Set<string>();

/**
 * An SGR sequence, or a control character other than a tab and a newline: the
 * C0 range, DEL and the C1 range. ESC opens every sequence a terminal acts on
 * (a cursor move, a line erase, an OSC 52 clipboard write, an OSC 8 link), and
 * U+009B and U+009D are the one-character forms of CSI and OSC.
 */
const TERMINAL_CONTROL =
	// oxlint-disable-next-line no-control-regex -- matching control characters is what this pattern is for
	/\u001b\[(\d+)m|[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * Text as it may reach the terminal. What the CLI prints is mostly written by
 * somebody else: a description copied from a calendar invite, a project name,
 * an error message, a committed `.farmer.jsonc`. A control character in it
 * would drive the terminal instead of being shown, so every one but a tab and
 * a newline is dropped. The SGR sequences of this module's own colors stay.
 * What followed a dropped ESC stays too, as plain text.
 */
export const sanitizeForTerminal = (text: string): string =>
	text.replace(TERMINAL_CONTROL, (match: string, code: string | undefined) => {
		if (code === undefined) return "";
		return ownCodes.has(code) ? match : match.slice(ESC.length);
	});

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

const ansi = (open: number, close: number) => {
	ownCodes.add(String(open)).add(String(close));
	return (out: Output, text: string) =>
		out.color ? `${ESC}[${open}m${text}${ESC}[${close}m` : text;
};

export const bold = ansi(1, 22);
export const dim = ansi(2, 22);
export const green = ansi(32, 39);
export const yellow = ansi(33, 39);
export const red = ansi(31, 39);

export const print = (text: string) => {
	process.stdout.write(`${sanitizeForTerminal(text)}\n`);
};

// JSON.stringify escapes the C0 controls but writes DEL and the C1 controls as
// they are. They only ever sit inside a string there, where a \u escape reads
// back as the same value.
const JSON_RAW_CONTROL = /[\u007f-\u009f]/g;

const jsonEscape = (char: string) =>
	`\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;

export const printJson = <T>(value: T) => {
	process.stdout.write(
		`${JSON.stringify(value, null, 2)}\n`.replace(JSON_RAW_CONTROL, jsonEscape),
	);
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
	process.stderr.write(`${prefix} ${sanitizeForTerminal(text)}\n`);
};

export const warn = (text: string) => toStderr("warning:", 33, text);

export const printError = (text: string) => toStderr("error:", 31, text);

/** Progress lines for the person, on stderr so they never mix into a result. */
export const note = (text: string) => {
	process.stderr.write(`${sanitizeForTerminal(text)}\n`);
};
