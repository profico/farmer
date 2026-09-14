import { type ParseArgsOptionsConfig, parseArgs } from "node:util";

import { UsageError } from "../errors";
import type { Runtime } from "../runtime";

export type Command = {
	/** `log`, or `org list` for a subcommand. */
	name: string;
	usage: string;
	summary: string;
	/** Lines under the usage in `farmer help <command>`. */
	help: string[];
	run: (args: string[], runtime: Runtime) => Promise<void>;
};

/** Accepted by every command. `--help` is answered by `main` before a
 *  command runs; it is declared here so strict parsing does not refuse it. */
export const GLOBAL_OPTIONS = {
	json: { type: "boolean" },
	org: { type: "string" },
	help: { type: "boolean", short: "h" },
} as const;

export const GLOBAL_HELP = [
	"  --json        Print the API response as JSON, and nothing else.",
	"  --org <slug>  Run in this organization instead of the default one.",
	"  -h, --help    Show this help.",
];

/**
 * Parses one command's arguments. Each command calls this with its own option
 * literal, so its `values` are typed by name rather than read out of a loose
 * record.
 */
export const parseCommandArgs = <const O extends ParseArgsOptionsConfig>(
	args: string[],
	options: O,
	maxPositionals: number,
	usage: string,
) => {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: { ...GLOBAL_OPTIONS, ...options },
			allowPositionals: true,
			strict: true,
		});
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new UsageError(`${reason}\nUsage: ${usage}`);
	}
	if (parsed.positionals.length > maxPositionals) {
		throw new UsageError(`Too many arguments.\nUsage: ${usage}`);
	}
	return parsed;
};
