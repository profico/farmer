/**
 * An error the CLI shows to the person as one line, without a stack trace.
 * Anything else that reaches `main` is a bug, and keeps its stack.
 */
export class CliError extends Error {
	readonly exitCode: number;
	/** The HTTP status that produced this error, when one did. */
	readonly status?: number;
	/**
	 * The `code` of the `ApiError` body, when the server sent one.
	 *
	 * A status alone cannot be branched on. Every organization route answers a
	 * JSON 404 when the server has `CLI_ENABLED=false`, and a route this
	 * server does not have at all answers a 404 with no body. `failureMessage`
	 * in `http.ts` turns the second into "update Farmer".
	 */
	readonly code?: string;

	constructor(
		message: string,
		exitCode = 1,
		details: { status?: number; code?: string } = {},
	) {
		super(message);
		this.name = "CliError";
		this.exitCode = exitCode;
		this.status = details.status;
		this.code = details.code;
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
