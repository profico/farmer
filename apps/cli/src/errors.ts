/**
 * An error the CLI shows to the person as one line, without a stack trace.
 * Anything else that reaches `main` is a bug, and keeps its stack.
 */
export class CliError extends Error {
	readonly exitCode: number;

	constructor(message: string, exitCode = 1) {
		super(message);
		this.name = "CliError";
		this.exitCode = exitCode;
	}
}

/** The command line itself was wrong: a missing argument, an unknown flag,
 *  a value that does not parse. Exit code 2, as most CLIs use for usage. */
export class UsageError extends CliError {
	constructor(message: string) {
		super(message, 2);
		this.name = "UsageError";
	}
}

/** The person pressed Ctrl+C or Escape in a prompt. 130 is what a shell
 *  reports for SIGINT, so scripts read it the same way. */
export class CancelledError extends CliError {
	constructor() {
		super("Cancelled.", 130);
		this.name = "CancelledError";
	}
}
