import { describe, expect, spyOn, test } from "bun:test";

import {
	bold,
	dim,
	green,
	note,
	type Output,
	print,
	printError,
	printJson,
	red,
	sanitizeForTerminal,
	warn,
	yellow,
} from "./output";

const colored: Output = {
	json: false,
	color: true,
	interactive: false,
	stdoutTty: true,
	columns: null,
};

// An OSC 52 clipboard write, then a line erase: the payload of a hostile
// calendar invite title or a committed `.farmer.jsonc` org value.
const HOSTILE = "Standup\u001b]52;c;ZWNobyBoaQ==\u0007\u001b[2K";
const SHOWN = "Standup]52;c;ZWNobyBoaQ==[2K";

describe("sanitizeForTerminal", () => {
	test("drops the ESC and BEL of a sequence and keeps the rest as text", () => {
		expect(sanitizeForTerminal(HOSTILE)).toBe(SHOWN);
	});

	test("keeps the CLI's own colors", () => {
		for (const paint of [bold, dim, green, yellow, red]) {
			const text = `${paint(colored, "on track")} on ${paint(colored, "1:30")}`;
			expect(sanitizeForTerminal(text)).toBe(text);
		}
	});

	test("drops the ESC of an SGR sequence the CLI does not write", () => {
		expect(sanitizeForTerminal("a\u001b[8mhidden\u001b[0m")).toBe(
			"a[8mhidden[0m",
		);
	});

	test("keeps a tab and a newline, and drops every other control", () => {
		expect(sanitizeForTerminal("a\tb\nc")).toBe("a\tb\nc");
		expect(
			sanitizeForTerminal("1:00\r9:00\b\u0000\u007f\u009b2K\u009d8;;x"),
		).toBe("1:009:002K8;;x");
	});

	test("a dropped character never joins the rest into a sequence", () => {
		expect(sanitizeForTerminal("\u001b\u0000[2K\u001b[1\u0000m\u001b[")).toBe(
			"[2K[1m[",
		);
	});
});

describe("the writers", () => {
	/** What `run` wrote to stdout and stderr, in order, with the stderr
	 *  labels uncolored so the lines compare exactly. */
	const writes = (run: () => void): string[] => {
		const written: string[] = [];
		const capture = (chunk: string | Uint8Array) => {
			written.push(String(chunk));
			return true;
		};
		const noColor = process.env.NO_COLOR;
		process.env.NO_COLOR = "1";
		const out = spyOn(process.stdout, "write").mockImplementation(capture);
		const err = spyOn(process.stderr, "write").mockImplementation(capture);
		try {
			run();
		} finally {
			out.mockRestore();
			err.mockRestore();
			if (noColor === undefined) delete process.env.NO_COLOR;
			else process.env.NO_COLOR = noColor;
		}
		return written;
	};

	test("print, note, warn and printError write no terminal control", () => {
		expect(
			writes(() => {
				print(HOSTILE);
				note(HOSTILE);
				warn(HOSTILE);
				printError(`Not one of your organizations: "x${HOSTILE}".`);
			}),
		).toEqual([
			`${SHOWN}\n`,
			`${SHOWN}\n`,
			`warning: ${SHOWN}\n`,
			`error: Not one of your organizations: "x${SHOWN}".\n`,
		]);
	});

	test("print keeps the colors it was handed", () => {
		const text = `${bold(colored, "Mon 2026-09-14")} ${red(colored, "behind")}`;
		expect(writes(() => print(text))).toEqual([`${text}\n`]);
	});

	test("printJson escapes DEL and the C1 controls, and the value reads back the same", () => {
		const value = { description: "a\u009b2Kb\u007fc\u001bd" };
		const [line] = writes(() => printJson(value));
		expect(line).toBe('{\n  "description": "a\\u009b2Kb\\u007fc\\u001bd"\n}\n');
		expect(JSON.parse(line ?? "")).toEqual(value);
	});
});
