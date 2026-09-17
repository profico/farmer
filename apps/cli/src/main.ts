#!/usr/bin/env bun
import { z } from "zod";

import { commandHelp, findCommand, mainHelp, subcommandsOf } from "./commands";
import { CliError, UsageError } from "./errors";
import { print, printError } from "./output";
import { systemRuntime } from "./runtime";
import { CLI_VERSION } from "./version";

/** Global flags may come before the command (`farmer --org acme today`).
 *  They are moved behind it, where the command's own parser reads them. */
const splitLeadingFlags = (argv: string[]) => {
	const leading: string[] = [];
	let index = 0;

	while (index < argv.length && argv[index]?.startsWith("-")) {
		const token = argv[index] ?? "";
		leading.push(token);

		if (token === "--org" && index + 1 < argv.length) {
			leading.push(argv[index + 1] ?? "");
			index++;
		}

		index++;
	}

	return { leading, rest: argv.slice(index) };
};

const run = async (argv: string[]) => {
	const { leading, rest } = splitLeadingFlags(argv);

	if (leading.includes("--version") || leading.includes("-v")) {
		print(`farmer ${CLI_VERSION}`);

		return;
	}

	const [first, ...afterFirst] = rest;

	if (first === "version") {
		print(`farmer ${CLI_VERSION}`);

		return;
	}

	if (first === undefined || first === "help") {
		const topic = first === "help" ? findCommand(afterFirst) : null;

		if (first === "help" && afterFirst.length > 0 && !topic) {
			throw new UsageError(
				`Unknown command "${afterFirst.join(" ")}". Run \`farmer help\`.`,
			);
		}

		print(topic ? commandHelp(topic.command) : mainHelp());

		return;
	}

	const match = findCommand(rest);

	if (!match) {
		const group = subcommandsOf(first);
		throw new UsageError(
			group.length > 0
				? `Use one of: ${group.map((command) => command.usage).join(", ")}.`
				: `Unknown command "${first}". Run \`farmer help\`.`,
		);
	}

	const args = [...leading, ...match.args];

	if (args.includes("--help") || args.includes("-h")) {
		print(commandHelp(match.command));

		return;
	}

	await match.command.run(args, systemRuntime());
};

/** The reader of stdout went away: `farmer ls | head -3` once head has its
 *  three lines. That is the reader's choice, not a failure, so the CLI stops
 *  without the runtime's stack trace. */
const brokenPipe = z.object({ code: z.literal("EPIPE") });

process.stdout.on("error", (error) => {
	if (brokenPipe.safeParse(error).success) process.exit(0);
	throw error;
});

try {
	await run(process.argv.slice(2));
} catch (error) {
	if (brokenPipe.safeParse(error).success) process.exit(0);

	if (!(error instanceof CliError)) throw error;
	printError(error.message);
	process.exitCode = error.exitCode;
}
