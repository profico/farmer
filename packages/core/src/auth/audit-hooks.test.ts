// The failed sign-in row of the audit log (issue #112): one row per person in
// each window, and only for an address that has an account.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { auditEvent } from "../db/schema/audit";
import { member, organization, user } from "../db/schema/auth";
import { createTestDb, type TestDb } from "../test/harness";
import { FAILED_SIGN_IN_WINDOW_MS, recordFailedSignIn } from "./audit-hooks";

const USER = "u-ah-ana";
const EMAIL = "ana-ah@example.com";
const OLD_USER = "u-ah-bo";
const OLD_EMAIL = "bo-ah@example.com";
const ORGS = ["ah-org-1", "ah-org-2"];

let harness: TestDb;

beforeAll(async () => {
	harness = await createTestDb();
	await db
		.insert(organization)
		.values(
			ORGS.map((id) => ({ id, name: id, slug: id, createdAt: new Date() })),
		);
	await db.insert(user).values({
		id: USER,
		name: "Ana",
		email: EMAIL,
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values(
		ORGS.map((organizationId, index) => ({
			id: `ah-m${index}`,
			organizationId,
			userId: USER,
			role: "member",
			createdAt: new Date(),
		})),
	);
});

afterAll(async () => {
	await harness.close();
});

const failedRows = () =>
	db
		.select()
		.from(auditEvent)
		.where(eq(auditEvent.kind, "auth.sign_in_failed"));

describe("recordFailedSignIn", () => {
	test("writes one row to each workspace of the person", async () => {
		await recordFailedSignIn(EMAIL, new Headers(), "invalid password");
		expect(await failedRows()).toHaveLength(ORGS.length);
	});

	test("skips repeated attempts inside the window, in any case of the email", async () => {
		await recordFailedSignIn(EMAIL.toUpperCase(), new Headers(), null);
		await recordFailedSignIn(EMAIL, new Headers(), null);
		expect(await failedRows()).toHaveLength(ORGS.length);
	});

	test("writes again when the last row is older than the window", async () => {
		await db.insert(user).values({
			id: OLD_USER,
			name: "Bo",
			email: OLD_EMAIL,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(member).values({
			id: "ah-m-old",
			organizationId: ORGS[0] ?? "",
			userId: OLD_USER,
			role: "member",
			createdAt: new Date(),
		});
		// The table is append-only, so the old row goes in as an insert.
		await db.insert(auditEvent).values({
			organizationId: ORGS[0] ?? "",
			kind: "auth.sign_in_failed",
			category: "security",
			via: "web",
			subjectUserId: OLD_USER,
			occurredAt: new Date(Date.now() - FAILED_SIGN_IN_WINDOW_MS - 1000),
		});
		await recordFailedSignIn(OLD_EMAIL, new Headers(), null);
		const rows = await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.subjectUserId, OLD_USER));
		expect(rows).toHaveLength(2);
	});

	test("writes nothing for an address with no account", async () => {
		await recordFailedSignIn("nobody@example.com", new Headers(), null);
		expect(await failedRows()).toHaveLength(ORGS.length + 2);
	});
});
