import { ApiClientError } from "@farmer/api-client";

const MAX_RETRIES = 2;

/** A fault that a second try can fix: no answer from the network, or a
 *  server error (5xx). A refusal (401, 403, 404, 422 and the rest of 4xx) and
 *  an answer the app cannot read give the same result again. */
export const isTransient = (error: Error) =>
	error instanceof ApiClientError &&
	(error.kind === "unreachable" ||
		(error.kind === "http" && (error.status ?? 0) >= 500));

/** The `retry` option of the queries. */
export const shouldRetry = (failures: number, error: Error) =>
	failures < MAX_RETRIES && isTransient(error);
