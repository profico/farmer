import { z } from "zod";

import { AccessError } from "./access.service";
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
 *  - `not_found` / `refused` — an error whose constructor is exactly `Error`
 *    and carries no `code`: a sentence a service threw ON PURPOSE —
 *    `throw new Error("Time entry not found")`. The services use the bare
 *    class for this everywhere, and the runtime, the database driver and the
 *    ORM throw subclasses. `not_found` when the sentence says "not found".
 *  - `unsafe` — anything else. A `DrizzleQueryError` carries the SQL and its
 *    parameters, a `PostgresError` a table name, a `TypeError` a file path.
 *    It belongs in the server log, never in an answer.
 *
 * The `code` test exists because Node-style system errors (`ECONNREFUSED`
 * with an address in it) are bare `Error`s too; what marks them is `code`.
 *
 * The bare-`Error` rule is a convention rather than a type, and it is the one
 * to watch. The integration clients in `lib/` break it today —
 * `github-client.ts` throws `GitHub API error 404: <url>` — and a service that
 * starts throwing a bare `Error` with a raw database message in it would put
 * that text in front of a client. Throw a subclass for anything that is not a
 * sentence for the person.
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
	if (error.constructor === Error && !("code" in error)) {
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
