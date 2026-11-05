import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { db, schema } from "@farmer/core/db";
import { PostHog } from "posthog-node";

// The harness is not a package export, so this reads it by its path. It is
// the only way to get a real database error in this workspace.
import {
	closeTestEngine,
	createTestDb,
	present,
	type TestDb,
} from "../../../../packages/core/src/test/harness.ts";
import { type ApiRequestReport, captureApiFailure } from "./posthog-api";
import * as posthogServer from "./posthog-server";

const SECRET = "secret-person@example.com";

const REPORT: ApiRequestReport = {
	userId: "user-1",
	organizationId: "org-1",
	method: "POST",
	pathname: "/api/v1/orgs/acme/time-entries",
	status: 500,
	durationMs: 3,
	cliVersion: "1.0.0",
	credential: "api_token",
};

let testDb: TestDb;
beforeAll(async () => {
	testDb = await createTestDb();
});
// No other file in this workspace opens the engine, and an engine that is
// open at exit makes `bun test` fail the run (exit 99).
afterAll(async () => {
	await testDb.close();
	await closeTestEngine();
});

const person = (id: string) => ({
	id,
	name: "Person",
	email: SECRET,
	emailVerified: false,
	createdAt: new Date(),
	updatedAt: new Date(),
});

/** A real `DrizzleQueryError` whose message holds the email. */
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

/** The error that `captureApiFailure` gives to PostHog. The client is real,
 *  but its `captureException` sends nothing. */
const sentToPostHog = (error: Error): Error => {
	const client = new PostHog("test-token", { disabled: true });
	const capture = spyOn(client, "captureException").mockImplementation(
		() => {},
	);
	const getClient = spyOn(posthogServer, "getPostHogClient").mockReturnValue(
		client,
	);
	try {
		captureApiFailure(error, REPORT);
		const [sent] = present(capture.mock.calls[0], "a captureException call");
		if (!(sent instanceof Error)) throw new Error("PostHog got a non-Error");
		return sent;
	} finally {
		getClient.mockRestore();
	}
};

describe("captureApiFailure", () => {
	test("a database error goes to PostHog without the values of its query", async () => {
		const error = await duplicateEmailError();
		// The premise: the raw error holds the email.
		expect(error.message).toContain(SECRET);

		const sent = sentToPostHog(error);

		expect(sent.message).not.toContain(SECRET);
		expect(String(sent.stack)).not.toContain(SECRET);
		expect(sent.cause).toBeUndefined();
		expect(sent.name).toBe("DrizzleQueryError");
		expect(sent.message).toContain("23505");
		expect(sent.stack).toContain(" at ");
	});

	test("a different error goes to PostHog unchanged", () => {
		const error = new TypeError("fetch failed");

		expect(sentToPostHog(error)).toBe(error);
	});
});
