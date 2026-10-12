import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db, schema } from "../db";
import { createTestDb, present, type TestDb } from "../test/harness";
import { loggableError, loggableErrorLine } from "./loggable-error";

const SECRET = "secret-person@example.com";

let testDb: TestDb;
beforeAll(async () => {
	testDb = await createTestDb();
});
afterAll(async () => {
	await testDb.close();
});

const person = (id: string) => ({
	id,
	name: "Person",
	email: SECRET,
	emailVerified: false,
	createdAt: new Date(),
	updatedAt: new Date(),
});

/** A real `DrizzleQueryError`: the second insert breaks the unique email, and
 *  Drizzle puts the email in its message as a query parameter. */
const duplicateEmailError = async (): Promise<Error> => {
	await db.delete(schema.user);
	await db.insert(schema.user).values(person("first"));
	const caught = await db
		.insert(schema.user)
		.values(person("second"))
		.then(
			() => null,
			(error: unknown) => (error instanceof Error ? error : null),
		);
	return present(caught, "the duplicate insert's error");
};

describe("loggableError", () => {
	test("a database error keeps its code and place, and loses its values", async () => {
		const error = await duplicateEmailError();
		// The premise: without the helper, the log line holds the email.
		expect(error.message).toContain(SECRET);
		expect(String(error.stack)).toContain(SECRET);

		const result = loggableError(error);

		expect(JSON.stringify(result)).not.toContain(SECRET);
		expect(loggableErrorLine(error)).not.toContain(SECRET);
		expect(result).toMatchObject({
			error: "DrizzleQueryError",
			code: "23505",
			constraint: "user_email_unique",
			table: "user",
		});
		expect(result.message).toBeUndefined();
		expect(result.stack).toContain(" at ");
	});

	test("an error that wraps a database error loses every message", async () => {
		const inner = await duplicateEmailError();
		const outer = new Error(`could not save ${SECRET}`, { cause: inner });

		const result = loggableError(outer);

		expect(JSON.stringify(result)).not.toContain(SECRET);
		expect(result.code).toBe("23505");
	});

	test("an error with no database error in its chain keeps its messages", () => {
		const error = new TypeError("fetch failed", {
			cause: Object.assign(new Error("connect ECONNREFUSED"), {
				code: "ECONNREFUSED",
			}),
		});

		expect(loggableError(error)).toMatchObject({
			error: "TypeError",
			message: "fetch failed",
			cause: ["Error: connect ECONNREFUSED"],
			code: "ECONNREFUSED",
		});
		expect(loggableErrorLine(error)).toBe(
			"TypeError: fetch failed; cause Error: connect ECONNREFUSED (code ECONNREFUSED)",
		);
	});

	test("an error with no database error keeps its own properties", () => {
		const error = Object.assign(new Error("rate limited"), {
			name: "APIError",
			status: 403,
			errno: -111,
			syscall: "connect",
			resetAt: "2026-10-12T10:00:00Z",
			retry: () => {},
		});
		const wrapper = Object.assign(new Error("failed", { cause: error }), {
			status: 500,
		});

		const result = loggableError(wrapper);

		expect(result).toMatchObject({
			error: "Error",
			message: "failed",
			status: 500,
			errno: -111,
			syscall: "connect",
			resetAt: "2026-10-12T10:00:00Z",
		});
		expect(result).not.toHaveProperty("retry");
		expect(result).not.toHaveProperty("name");
		expect(loggableErrorLine(wrapper)).not.toContain("status");
	});

	test("a chain with a database error drops the other properties", async () => {
		const inner = await duplicateEmailError();
		const outer = Object.assign(new Error("could not save", { cause: inner }), {
			status: 500,
			body: SECRET,
		});

		const result = loggableError(outer);

		expect(result).not.toHaveProperty("status");
		expect(result).not.toHaveProperty("body");
		expect(JSON.stringify(result)).not.toContain(SECRET);
	});

	test("a thrown value that is not an Error shows none of its content", () => {
		expect(JSON.stringify(loggableError(SECRET))).not.toContain(SECRET);
	});
});
