import { z } from "zod";

import { UserFacingError } from "../lib/user-facing-error";
import { AccessError } from "./access.service";
import {
	PROJECT_NOT_FOUND_MESSAGE,
	TASK_NOT_AVAILABLE_MESSAGE,
} from "./guards";
import { DayCapacityError } from "./time-entries.service";

/**
 * What a caller outside this process may be told about an error a service
 * threw. The CLI's REST API, the MCP server and the assistant's tool results
 * all use this one answer.
 *
 *  - `validation`: a `ZodError`. The input was understood and refused.
 *  - `capacity`: a `DayCapacityError`. The day is full.
 *  - `forbidden`: an `AccessError`. Its message is written for the person.
 *  - `not_found` / `refused`: any other `UserFacingError`
 *    (`lib/user-facing-error.ts`), or an error whose constructor is exactly
 *    `Error` and has no `code`: a sentence that a service threw on purpose,
 *    such as `throw new Error("Time entry not found")`. `not_found` when the
 *    sentence says "not found".
 *  - `unsafe`: anything else. A `DrizzleQueryError` carries the SQL, a
 *    `PostgresError` a table name, a `TypeError` a file path. These go to the
 *    server log, never to an answer.
 *
 * Exposure is a property of the class: extend `UserFacingError` to be read.
 * The bare-`Error` branch is a convention, not a type, so watch it. A service
 * that throws a bare `Error` with a raw database message would show that text
 * to a client. `github-client.ts` already does this (`GitHub API error 404:
 * <url>`). Throw a subclass for anything that is not a sentence for the person.
 *
 * The `code` test excludes Node system errors (`ECONNREFUSED` with an address),
 * which are bare `Error`s too.
 */
export type ServiceErrorVerdict =
	| { kind: "validation"; message: string; error: z.core.$ZodError }
	| {
			kind: "capacity" | "forbidden" | "not_found" | "refused";
			message: string;
	  }
	| { kind: "unsafe" };

export const classifyServiceError = (error: Error): ServiceErrorVerdict => {
	if (error instanceof z.core.$ZodError) {
		return { kind: "validation", message: error.message, error };
	}
	if (error instanceof DayCapacityError) {
		return { kind: "capacity", message: error.message };
	}
	if (error instanceof AccessError) {
		return { kind: "forbidden", message: error.message };
	}
	if (
		error instanceof UserFacingError ||
		(error.constructor === Error && !("code" in error))
	) {
		return {
			kind: /not found/i.test(error.message) ? "not_found" : "refused",
			message: error.message,
		};
	}
	return { kind: "unsafe" };
};

/** The message a client may read for this error, or null when it must not
 *  see it. See `classifyServiceError`. */
export const safeErrorMessage = (error: Error): string | null => {
	const verdict = classifyServiceError(error);
	return verdict.kind === "unsafe" ? null : verdict.message;
};

// How an agent recovers from a refused id. The id guards keep a short message
// for the web app, the REST API and the CLI; only an agent gets the hint. The
// text is the same for an id that is missing and an id of another organization,
// so it does not tell the caller which one it was. Both tool names exist in the
// registry that the MCP server and the assistant share.
const RECOVERY_HINTS = new Map([
	[
		TASK_NOT_AVAILABLE_MESSAGE,
		"it is archived or does not exist in this organization. Call list_tasks to get the current task ids.",
	],
	[
		PROJECT_NOT_FOUND_MESSAGE,
		"it does not exist in this organization. Call list_projects to get the current project ids.",
	],
]);

/**
 * The message a model may read for a failed tool call, or null when it must not
 * see it. It is `safeErrorMessage` plus a recovery hint for a refused task or
 * project id. Any other message is unchanged. The MCP server and the assistant
 * both send a tool failure to a model, so both use this function.
 */
export const agentErrorMessage = (error: Error): string | null => {
	const message = safeErrorMessage(error);
	return message === null ? null : withRecoveryHint(message);
};

/**
 * Adds the recovery hint to a message that a person may already read. Use it
 * for a reason that a service collected as text, such as the `firstError` of a
 * batch filing, where there is no error object left to give to
 * `agentErrorMessage`.
 */
export const withRecoveryHint = (message: string): string => {
	const hint = RECOVERY_HINTS.get(message);
	return hint === undefined ? message : `${message}: ${hint}`;
};

// Re-exported so a caller of the services barrel can extend or test for it
// without reaching into `lib/`.
export { UserFacingError } from "../lib/user-facing-error";
