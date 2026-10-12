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
//
// A chain with no database error keeps more: the own enumerable properties of
// each link, such as `status`, `resetAt`, `errno` or `syscall`, which a raw
// `console.error(error)` showed. A chain with a database error never does,
// because a property of a driver error can hold a value of the query.

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

/** The own properties of an error that a log line may show: a plain value,
 *  never a function, an object or an error. */
const extraProperties = z.record(
	z.string(),
	z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
type ExtraProperties = z.infer<typeof extraProperties>;

type LoggableFields = {
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

/** The fields above, and for a chain with no database error the own
 *  properties of its links, such as `status` or `errno`. */
export type LoggableError = LoggableFields & ExtraProperties;

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

/**
 * The class names of a database error, as `name` or the constructor gives
 * them: Drizzle's `DrizzleQueryError`, postgres.js's `PostgresError`, and the
 * `DatabaseError` of PGLite and pg, whose `name` is `error`.
 *
 * `withoutQueryValues` and the PostHog `before_send` filter
 * (`apps/web/src/lib/posthog-server.ts`) both read this list.
 */
export const DATABASE_ERROR_CLASSES: ReadonlySet<string> = new Set([
	"DrizzleQueryError",
	"PostgresError",
	"DatabaseError",
	"error",
]);

/** Drizzle's class does not set `name`, so a tool that reads only `name` sees
 *  `Error`. Its message always starts with this text. */
const DRIZZLE_MESSAGE_START = "Failed query: ";

/** The message of a database error after `withoutQueryValues`, when no code
 *  or name is known. */
export const DATABASE_ERROR_MESSAGE = "Database error";

/** A message that `withoutQueryValues` made: the fixed text, and the code and
 *  the names of the constraint, the table and the column if known. */
const QUERY_FREE_MESSAGE =
	/^Database error(?: \((?:code|constraint|table|column) [^\s,()]+(?:, (?:code|constraint|table|column) [^\s,()]+)*\))?$/;

/** Whether an error with this class and this message is a database error.
 *  For a tool that has only the text of an error, not the error. */
export const isDatabaseErrorText = (
	type: string | undefined,
	message: string | undefined,
): boolean =>
	(type !== undefined && DATABASE_ERROR_CLASSES.has(type)) ||
	(message?.startsWith(DRIZZLE_MESSAGE_START) ?? false);

/** Whether a message holds no values of a query, because
 *  `withoutQueryValues` made it. */
export const isQueryFreeMessage = (message: string): boolean =>
	QUERY_FREE_MESSAGE.test(message);

const isDatabaseError = (error: Error): boolean =>
	error instanceof DrizzleQueryError ||
	serverError.safeParse(error).success ||
	DATABASE_ERROR_CLASSES.has(classOf(error));

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

/** The fields that `loggableError` sets itself, and the ones of an error that
 *  are never copied. */
const RESERVED = new Set([
	"error",
	"name",
	"message",
	"cause",
	"stack",
	"code",
	"constraint",
	"table",
	"column",
]);

/** The own enumerable properties of each link. The first link wins on a name
 *  clash. Only for a chain with no database error. */
const extraFieldsOf = (chain: readonly Error[]): ExtraProperties => {
	const extra: ExtraProperties = {};
	for (const link of chain) {
		for (const [key, value] of Object.entries(link)) {
			if (RESERVED.has(key) || key in extra) continue;
			const parsed = extraProperties.valueType.safeParse(value);
			if (parsed.success) extra[key] = parsed.data;
		}
	}
	return extra;
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
	// A database chain gives no extra field: the loop has no link to read.
	const result: LoggableError = {
		...extraFieldsOf(database ? [] : chain),
		error: classOf(first),
	};
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
	const logged = loggableError(cause);
	const { error, message, cause: causes } = logged;
	const named = (["code", "constraint", "table", "column"] as const).flatMap(
		(key) => (logged[key] === undefined ? [] : [`${key} ${logged[key]}`]),
	);
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
			? `${DATABASE_ERROR_MESSAGE} (${places.join(", ")})`
			: DATABASE_ERROR_MESSAGE,
	);
	copy.name = classOf(error);
	copy.stack = `${copy.name}: ${copy.message}\n${framesOf(error.stack ?? "")}`;
	return copy;
};
