// The session hook (`databaseHooks.session.create.before`) picks the active
// organization from the oldest membership. A membership with a Harvest
// import's pending claim is not one the person joined, so the hook skips it,
// through better-auth's own sign-in endpoint so the hook runs as it does in
// production.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, session, user } from "../db/schema/auth";
import { memberProfile } from "../db/schema/people";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
import { createTestDb, present, type TestDb } from "../test/harness";
import { auth } from "./index";

const PASSWORD = "correct horse battery";
const IMPORTER = "org-session-importer";

let harness: TestDb;

beforeAll(async () => {
	harness = await createTestDb();
	// Every test signs up a new person, and registration closes after the
	// first account.
	setInstanceSettingsForTests({ REGISTRATION_OPEN: "true" });
	await db.insert(organization).values({
		id: IMPORTER,
		name: "Importer",
		slug: "session-importer",
		createdAt: new Date(),
	});
});

afterAll(async () => {
	setInstanceSettingsForTests(undefined);
	await harness.close();
});

/** Signs up (which makes the person's own workspace), then gives them an
 *  OLDER membership in the importer with a pending claim. */
const personWithClaim = async (email: string) => {
	await auth.api.signUpEmail({
		body: { name: email.split("@")[0] ?? "Someone", email, password: PASSWORD },
	});
	const person = present(
		await db.query.user.findFirst({ where: eq(user.email, email) }),
		`the user ${email}`,
	);
	await db.insert(member).values({
		id: crypto.randomUUID(),
		organizationId: IMPORTER,
		userId: person.id,
		role: "member",
		createdAt: new Date("2020-01-01T00:00:00Z"),
	});
	await db.insert(memberProfile).values({
		organizationId: IMPORTER,
		userId: person.id,
		claimPendingSince: new Date(),
	});
	return person;
};

const activeOrgAfterSignIn = async (email: string) => {
	const { token } = await auth.api.signInEmail({
		body: { email, password: PASSWORD },
	});
	const row = present(
		await db.query.session.findFirst({ where: eq(session.token, token) }),
		"the new session",
	);
	return row.activeOrganizationId;
};

describe("session.create.before", () => {
	test("skips an older membership with a pending claim", async () => {
		const person = await personWithClaim("claimant@example.com");
		const own = present(
			await db.query.member.findFirst({
				where: and(eq(member.userId, person.id), eq(member.role, "owner")),
			}),
			"the claimant's own workspace",
		);
		expect(await activeOrgAfterSignIn("claimant@example.com")).toBe(
			own.organizationId,
		);
	});

	test("leaves no active organization when the claim is all there is", async () => {
		const person = await personWithClaim("only-claim@example.com");
		await db
			.delete(member)
			.where(and(eq(member.userId, person.id), eq(member.role, "owner")));
		expect(await activeOrgAfterSignIn("only-claim@example.com")).toBe(null);
	});

	test("picks the organization once the claim is accepted", async () => {
		const person = await personWithClaim("accepted@example.com");
		await db
			.update(memberProfile)
			.set({ claimPendingSince: null })
			.where(
				and(
					eq(memberProfile.organizationId, IMPORTER),
					eq(memberProfile.userId, person.id),
				),
			);
		expect(await activeOrgAfterSignIn("accepted@example.com")).toBe(IMPORTER);
	});
});
