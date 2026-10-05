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
 * threw — one answer for the CLI's REST API, the MCP server and the tool
 * results the assistant sends to its model provider.
 *
 *  - `validation` — a `ZodError`: the input was understood and refused.
 *  - `capacity` — a `DayCapacityError`: the day is full.
 *  - `forbidden` — an `AccessError`. Its message is written for the person
 *    ("You are not assigned to this project").
 *  - `not_found` / `refused` — any other `UserFacingError`
 *    (`lib/user-facing-error.ts`): a class that promises its message is a
 *    sentence for the person — an upload refused, GitHub throttling, the
 *    assistant not connected. Also an error whose constructor is exactly
 *    `Error` and carries no `code`: a sentence a service threw ON PURPOSE —
 *    `throw new Error("Time entry not found")`. `not_found` when the sentence
 *    says "not found".
 *  - `unsafe` — anything else. A `DrizzleQueryError` carries the SQL and its
 *    parameters, a `PostgresError` a table name, a `TypeError` a file path.
 *    It belongs in the server log, never in an answer.
 *
 * Exposure is a property of the class: extend `UserFacingError` to be read.
 * The bare-`Error` branch is the fallback for the services' many
 * `throw new Error("…")` sentences, and it is the one to watch — it is a
 * convention rather than a type. The integration clients in `lib/` break it
 * today (`github-client.ts` throws `GitHub API error 404: <url>`), and a
 * service that starts throwing a bare `Error` with a raw database message in
 * it would put that text in front of a client. Throw a subclass for anything
 * that is not a sentence for the person.
 *
 * The `code` test exists because Node-style system errors (`ECONNREFUSED`
 * with an address in it) are bare `Error`s too; what marks them is `code`.
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
	if (message === null) return null;
	const hint = RECOVERY_HINTS.get(message);
	return hint === undefined ? message : `${message}: ${hint}`;
};

// Re-exported so a caller of the services barrel can extend or test for it
// without reaching into `lib/`.
export { UserFacingError } from "../lib/user-facing-error";
