import { describe, expect, test } from "bun:test";

import type { EventMessage } from "posthog-node";

import { withoutDatabaseValues } from "./posthog-server";

const SECRET = "secret-person@example.com";

const FRAMES = [
	{
		platform: "node:javascript",
		filename: "/app/node_modules/drizzle-orm/pg-core/session.js",
		function: "queryWithCache",
		lineno: 41,
		colno: 19,
		in_app: false,
	},
];

/** An `$exception` event as posthog-node 5.52 builds it for a Drizzle error
 *  with the driver's error in `cause`. Drizzle's class does not set `name`,
 *  so its entry has the type `Error`. */
const exceptionEvent = (
	entries: { type: string; value: string }[],
): EventMessage => ({
	distinctId: "user-1",
	event: "$exception",
	properties: {
		$exception_level: "error",
		$exception_list: entries.map((entry, index) => ({
			...entry,
			mechanism:
				index === 0
					? { type: "onunhandledrejection", handled: false, exception_id: 0 }
					: {
							type: "chained",
							source: "cause",
							exception_id: index,
							parent_id: index - 1,
						},
			stacktrace: { type: "raw", frames: FRAMES },
		})),
		api_route: "/api/v1/orgs/:orgSlug/time-entries",
	},
});

describe("withoutDatabaseValues", () => {
	test("a database error loses its values and keeps its types and frames", () => {
		const event = exceptionEvent([
			{
				type: "Error",
				value: `Failed query: insert into "user" ("id", "email") values ($1, $2)\nparams: u2,${SECRET}`,
			},
			{
				type: "PostgresError",
				value: `invalid input syntax for type uuid: "${SECRET}"`,
			},
		]);

		const sent = withoutDatabaseValues(event);

		expect(JSON.stringify(sent)).not.toContain(SECRET);
		expect(sent?.properties).toMatchObject({
			api_route: "/api/v1/orgs/:orgSlug/time-entries",
			$exception_list: [
				{
					type: "Error",
					value: "Database error",
					stacktrace: { frames: FRAMES },
				},
				{
					type: "PostgresError",
					value: "Database error",
					stacktrace: { frames: FRAMES },
					mechanism: { source: "cause" },
				},
			],
		});
	});

	test("a message without values from withoutQueryValues stays", () => {
		const value = "Database error (code 23505, constraint user_email_unique)";
		const event = exceptionEvent([{ type: "DrizzleQueryError", value }]);

		expect(withoutDatabaseValues(event)?.properties).toMatchObject({
			$exception_list: [{ type: "DrizzleQueryError", value }],
		});
	});

	test("a different error goes on unchanged", () => {
		const event = exceptionEvent([
			{ type: "TypeError", value: "fetch failed" },
		]);

		expect(withoutDatabaseValues(event)).toBe(event);
	});
});
