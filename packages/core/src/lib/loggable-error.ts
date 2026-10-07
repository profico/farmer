// An error, as a server log line may show it.
//
// A database error carries the values of its query. Drizzle's
// `DrizzleQueryError` puts the SQL and ALL of its parameters in `message`,
// and its stack starts with that message. The driver's error in `cause` keeps
// the parameters in its own fields, and its `detail` names the value that
// broke a constraint ("Key (email)=(…) already exists."). A failed write can
// therefore put a session token, a token hash, a push relay id or an email
// address into the log.
//
// `loggableError` keeps what tells a person what failed — the class, the
// SQLSTATE code, the constraint, the table and the column — and removes the
// messages when the chain holds a database error. Use it for each caught error
// that a request or a job writes to the log.

import { DrizzleQueryError } from "drizzle-orm/errors";
import { z } from "zod";

/** A chain longer than this is cut. A `cause` can point back at its error. */
const MAX_CHAIN = 5;

/** An error that the database server sent: postgres.js's `PostgresError` and
 *  PGLite's `DatabaseError` both have a severity and a SQLSTATE code. */
const serverError = z.object({
	severity: z.string(),
	code: z.string().regex(/^[0-9A-Z]{5}$/),
});

/** The fields that name a place, never a value. postgres.js spells them
 *  `constraint_name`, `table_name` and `column_name`; PGLite spells them
 *  without the suffix. */
const field = z.string().min(1).optional().catch(undefined);
const placeFields = z.object({
	code: field,
	constraint: field,
	constraint_name: field,
	table: field,
	table_name: field,
	column: field,
	column_name: field,
});

export type LoggableError = {
	/** The class of the error, such as `DrizzleQueryError` or `TypeError`. */
	error: string;
	/** Not present when the chain holds a database error. */
	message?: string;
	/** Each error in `cause`, in order: the class, and the message when the
	 *  chain holds no database error. */
	cause?: string[];
	/** The SQLSTATE code, or a system code such as `ECONNREFUSED`. */
	code?: string;
	constraint?: string;
	table?: string;
	column?: string;
	/** For a database error, only the frames: the first lines repeat the
	 *  message. */
	stack?: string;
};

const chainOf = (cause: unknown): Error[] => {
	const chain: Error[] = [];
	let link = cause;
	while (
		link instanceof Error &&
		chain.length < MAX_CHAIN &&
		!chain.includes(link)
	) {
		chain.push(link);
		link = link.cause;
	}
	return chain;
};

const isDatabaseError = (error: Error): boolean =>
	error instanceof DrizzleQueryError || serverError.safeParse(error).success;

/** PGLite's class has a minified constructor name, and Drizzle's class does
 *  not set `name`. So use `name` unless it is the default. */
const classOf = (error: Error): string =>
	error.name === "Error" ? error.constructor.name : error.name;

const framesOf = (stack: string): string =>
	stack
		.split("\n")
		.filter((line) => /^\s+at /.test(line))
		.join("\n");

/** The first value of each place field along the chain, as `[name, value]`
 *  pairs. A field that no link has is not in the list. */
const placesOf = (chain: readonly Error[]) => {
	const places: Pick<
		LoggableError,
		"code" | "constraint" | "table" | "column"
	> = {};
	for (const link of chain) {
		const parsed = placeFields.safeParse(link);
		if (!parsed.success) continue;
		const found = parsed.data;
		places.code ??= found.code;
		places.constraint ??= found.constraint ?? found.constraint_name;
		places.table ??= found.table ?? found.table_name;
		places.column ??= found.column ?? found.column_name;
	}
	return Object.entries(places).filter(
		(entry): entry is [string, string] => entry[1] !== undefined,
	);
};

/**
 * The parts of a caught value that a log line may show.
 *
 * When the error, or any error in its `cause` chain, is a database error, the
 * result has no message, and its stack has only the frames. Never put the
 * caught value itself beside the result: the log then shows it complete.
 */
export const loggableError = (cause: unknown): LoggableError => {
	const chain = chainOf(cause);
	const [first, ...rest] = chain;
	// A thrown string or object can hold anything, so only say what it was.
	if (!first) return { error: "a thrown value that is not an Error" };
	const database = chain.some(isDatabaseError);
	const result: LoggableError = { error: classOf(first) };
	if (!database) result.message = first.message;
	if (rest.length > 0) {
		result.cause = rest.map((link) =>
			database ? classOf(link) : `${classOf(link)}: ${link.message}`,
		);
	}
	Object.assign(result, Object.fromEntries(placesOf(chain)));
	if (first.stack) {
		result.stack = database ? framesOf(first.stack) : first.stack;
	}
	return result;
};

/** `loggableError` as one line without the stack, for a logger that takes a
 *  string: `DrizzleQueryError (code 23505, constraint user_email_unique)`. */
export const loggableErrorLine = (cause: unknown): string => {
	const {
		error,
		message,
		cause: causes,
		stack: _stack,
		...places
	} = loggableError(cause);
	const named = Object.entries(places).map(([key, value]) => `${key} ${value}`);
	const parts = [
		message === undefined ? error : `${error}: ${message}`,
		...(causes ?? []).map((link) => `cause ${link}`),
	];
	return named.length > 0
		? `${parts.join("; ")} (${named.join(", ")})`
		: parts.join("; ");
};

/**
 * The error, or a copy without the values of its query when the error or a
 * link of its `cause` chain is a database error.
 *
 * Use it before an error goes out of this process, for example to PostHog
 * error tracking. The copy keeps the class in `name` and the frames of the
 * stack, so the tool still groups it by class and by location. Its message
 * has only the code and the names of the constraint, the table and the
 * column. It has no `cause`, because the driver's error holds the values too.
 * A different error comes back unchanged.
 */
export const withoutQueryValues = (error: Error): Error => {
	const chain = chainOf(error);
	if (!chain.some(isDatabaseError)) return error;
	const places = placesOf(chain).map(([key, value]) => `${key} ${value}`);
	const copy = new Error(
		places.length > 0
			? `Database error (${places.join(", ")})`
			: "Database error",
	);
	copy.name = classOf(error);
	copy.stack = `${copy.name}: ${copy.message}\n${framesOf(error.stack ?? "")}`;
	return copy;
};
