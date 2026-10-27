import { z } from "zod";

/** The shape of a `DrizzleQueryError`: the SQL, and the driver error as cause.
 *  Read by shape, because a bundler can rename the class. */
const queryFailure = z.looseObject({
	query: z.string(),
	cause: z.looseObject({ code: z.coerce.string() }).optional(),
});

/**
 * An error that is safe to log or to send to PostHog.
 *
 * A `DrizzleQueryError` holds the SQL and the bound parameters in its message
 * and in `params`. A query that takes a raw credential (a session token from
 * `internalAdapter`) puts the credential in the log. For this error, return a
 * new one with the Postgres code of the cause and the route. Any other error
 * comes back unchanged, because its stack helps and it holds no parameters.
 */
export const safeError = (error: Error, route?: string): Error => {
	const failed = queryFailure.safeParse(error);
	if (!failed.success) return error;
	const summary = new Error(
		`DrizzleQueryError, Postgres code ${failed.data.cause?.code ?? "none"}${route ? `, route ${route}` : ""}`,
	);
	summary.name = "DrizzleQueryError";
	return summary;
};
