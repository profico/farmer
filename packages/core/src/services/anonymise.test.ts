// The account anonymise action (`anonymise.service.ts`): the answer to a
// request to delete an account. The `user` row stays, scrubbed, so the
// workspaces keep their time under "Deleted user".

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { toApiPerson } from "../api/people";
import { auth } from "../auth";
import { db } from "../db";
import { apiToken } from "../db/schema/api-tokens";
import { assistantConversation } from "../db/schema/assistant";
import { auditEvent } from "../db/schema/audit";
import {
	account,
	member,
	organization,
	session,
	user,
	verification,
} from "../db/schema/auth";
import { client, project, task, timeEntry } from "../db/schema/domain";
import { mobileDevice } from "../db/schema/mobile";
import { pushSubscription } from "../db/schema/notifications";
import { memberProfile } from "../db/schema/people";
import { runningTimer } from "../db/schema/timer";
import { PLATFORM_ADMIN_ROLE } from "../lib/platform-admin";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import {
	AnonymiseRefusedError,
	anonymiseService,
	deletedEmailFor,
} from "./anonymise.service";
import { hashApiToken } from "./api-tokens.service";
import { ledgerTotal } from "./ledger";
import { membersService } from "./members.service";
import type { Ctx } from "./types";

const ORG = "an-org";
const ORG_TWO = "an-org-two";
const SOLO_ORG = "an-solo-org";
const ADMIN = "u-an-admin";
const OWNER = "u-an-owner";
const SOLO = "u-an-solo";
const PASSWORD = "correct horse battery";
const OLD_EMAIL = "Leaving.Person@example.com";
const HOUR = 3600;
const RANGE = { from: "2026-08-01", to: "2026-08-31" };

let harness: TestDb;
let leaverId = "";
const admin = { userId: ADMIN };
const orgCtx: Ctx = { organizationId: ORG, userId: OWNER };

const seedUser = (id: string, role?: string) =>
	db.insert(user).values({
		id,
		name: id,
		email: `${id}@example.com`,
		emailVerified: true,
		role,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

beforeAll(async () => {
	harness = await createTestDb();
	const now = new Date();
	// The first account on an instance may register; it also claims the
	// platform admin role, which the next line takes back.
	const signedUp = await auth.api.signUpEmail({
		body: { name: "Leaving Person", email: OLD_EMAIL, password: PASSWORD },
	});
	leaverId = signedUp.user.id;
	await db.update(user).set({ role: "user" }).where(eq(user.id, leaverId));
	// A sign-up also makes a workspace of one's own, which would make the
	// leaver its only owner.
	await db.delete(organization);
	await db.insert(organization).values(
		[ORG, ORG_TWO, SOLO_ORG].map((id) => ({
			id,
			name: `Workspace ${id}`,
			slug: id,
			createdAt: now,
		})),
	);
	await seedUser(ADMIN, PLATFORM_ADMIN_ROLE);
	await seedUser(OWNER);
	await seedUser(SOLO);
	await db.insert(member).values([
		{
			id: "m-an-owner",
			organizationId: ORG,
			userId: OWNER,
			role: "owner",
			createdAt: now,
		},
		{
			id: "m-an-solo",
			organizationId: SOLO_ORG,
			userId: SOLO,
			role: "owner",
			createdAt: now,
		},
	]);

	await db
		.update(user)
		.set({ image: "https://example.com/me.png" })
		.where(eq(user.id, leaverId));
	await db.insert(member).values([
		{
			id: "m-an-leaver",
			organizationId: ORG,
			userId: leaverId,
			role: "member",
			createdAt: now,
		},
		{
			id: "m-an-leaver-2",
			organizationId: ORG_TWO,
			userId: leaverId,
			role: "member",
			createdAt: now,
		},
	]);

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG, name: "Acme" })
		.returning();
	const [p] = await db
		.insert(project)
		.values({
			organizationId: ORG,
			clientId: present(c, "client").id,
			name: "Farmer",
		})
		.returning();
	const [t] = await db
		.insert(task)
		.values({
			scope: "organization" as const,
			organizationId: ORG,
			name: "Development",
			isAbsence: false,
		})
		.returning();
	await db.insert(timeEntry).values({
		organizationId: ORG,
		userId: leaverId,
		projectId: present(p, "project").id,
		taskId: present(t, "task").id,
		date: "2026-08-11",
		description: "Worked",
		durationSeconds: 3 * HOUR,
	});
	await db.insert(runningTimer).values({
		organizationId: ORG,
		userId: leaverId,
		taskId: present(t, "task").id,
	});

	const live = await db.query.session.findFirst({
		where: eq(session.userId, leaverId),
	});
	await db.insert(mobileDevice).values({
		userId: leaverId,
		installationId: "install-1",
		platform: "ios",
		relayId: "relay-1",
		publicKey: "key",
		appVersion: "1.0.0",
		sessionId: present(live, "the sign-up session").id,
	});
	await db.insert(apiToken).values({
		userId: leaverId,
		organizationId: ORG,
		name: "CLI",
		tokenHash: hashApiToken("token-leaver"),
		hint: "leav",
		scope: "write",
	});
	await db.insert(pushSubscription).values({
		userId: leaverId,
		endpoint: "https://push.example.com/leaver",
		p256dh: "p",
		auth: "a",
	});
	await db.insert(assistantConversation).values({
		organizationId: ORG,
		userId: leaverId,
		model: "m",
	});
	await db.insert(verification).values([
		{
			id: "v-an-1",
			identifier: OLD_EMAIL.toLowerCase(),
			value: "x",
			expiresAt: new Date(Date.now() + 1e6),
		},
		{
			id: "v-an-2",
			identifier: "unrelated@example.com",
			value: "x",
			expiresAt: new Date(Date.now() + 1e6),
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("refusals", () => {
	test("a platform admin cannot anonymise themselves", async () => {
		const error = await anonymiseService
			.anonymise(admin, ADMIN)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(AnonymiseRefusedError);
		expect(error).toMatchObject({ reason: "self" });
	});

	test("the last platform admin is refused", async () => {
		await seedUser("u-an-other", "user");
		await expect(
			anonymiseService.anonymise({ userId: "u-an-other" }, ADMIN),
		).rejects.toMatchObject({ reason: "last_platform_admin" });
	});

	test("the only active owner of a workspace is refused, by name", async () => {
		await expect(anonymiseService.anonymise(admin, SOLO)).rejects.toThrow(
			`Workspace ${SOLO_ORG}`,
		);
		const kept = await db.query.user.findFirst({ where: eq(user.id, SOLO) });
		expect(kept?.name).toBe(SOLO);
	});

	test("an unknown account is refused", async () => {
		await expect(
			anonymiseService.anonymise(admin, "u-an-missing"),
		).rejects.toMatchObject({ reason: "not_found" });
	});
});

describe("anonymise", () => {
	test("scrubs the person and keeps the time", async () => {
		await anonymiseService.anonymise(admin, leaverId);

		const row = present(
			await db.query.user.findFirst({ where: eq(user.id, leaverId) }),
			"the user",
		);
		expect(row).toMatchObject({
			name: "Deleted user",
			email: deletedEmailFor(leaverId),
			image: null,
			emailVerified: false,
			banned: true,
			banReason: "Account deleted",
			role: "user",
		});
		expect(z.email().safeParse(row.email).success).toBe(true);

		expect(await ledgerTotal(orgCtx, RANGE, "worked")).toBe(3 * HOUR);
		const entries = await db.query.timeEntry.findMany({
			where: eq(timeEntry.userId, leaverId),
		});
		expect(entries).toHaveLength(1);
	});

	test("deletes the credentials and the personal rows", async () => {
		expect(
			await db.query.session.findMany({ where: eq(session.userId, leaverId) }),
		).toEqual([]);
		expect(
			await db.query.account.findMany({ where: eq(account.userId, leaverId) }),
		).toEqual([]);
		expect(
			await db.query.apiToken.findMany({
				where: eq(apiToken.userId, leaverId),
			}),
		).toEqual([]);
		expect(
			await db.query.mobileDevice.findMany({
				where: eq(mobileDevice.userId, leaverId),
			}),
		).toEqual([]);
		expect(
			await db.query.pushSubscription.findMany({
				where: eq(pushSubscription.userId, leaverId),
			}),
		).toEqual([]);
		expect(
			await db.query.runningTimer.findMany({
				where: eq(runningTimer.userId, leaverId),
			}),
		).toEqual([]);
		expect(
			await db.query.assistantConversation.findMany({
				where: eq(assistantConversation.userId, leaverId),
			}),
		).toEqual([]);
		const left = await db.query.verification.findMany();
		expect(left.map((v) => v.identifier)).toEqual(["unrelated@example.com"]);
	});

	test("archives each membership and records it in each workspace", async () => {
		const profiles = await db.query.memberProfile.findMany({
			where: eq(memberProfile.userId, leaverId),
		});
		expect(profiles.map((p) => p.organizationId).sort()).toEqual([
			ORG,
			ORG_TWO,
		]);
		expect(profiles.every((p) => p.archivedAt !== null)).toBe(true);

		const events = await db.query.auditEvent.findMany({
			where: eq(auditEvent.subjectUserId, leaverId),
		});
		for (const kind of ["member.archived", "member.anonymised"]) {
			const rows = events.filter((e) => e.kind === kind);
			expect(rows.map((e) => e.organizationId).sort()).toEqual([ORG, ORG_TWO]);
			expect(rows.every((e) => e.actorUserId === ADMIN)).toBe(true);
		}
	});

	test("a sign-in is refused, with the old address and the new", async () => {
		for (const email of [OLD_EMAIL, deletedEmailFor(leaverId)]) {
			await expect(
				auth.api.signInEmail({ body: { email, password: PASSWORD } }),
			).rejects.toThrow(/invalid email or password/i);
		}
	});

	test("the roster and the people read do not throw on the new address", async () => {
		const { members } = await membersService.roster(orgCtx);
		const person = present(
			members.find((m) => m.userId === leaverId),
			"the leaver in the roster",
		);
		expect(person.user.name).toBe("Deleted user");
		expect(person.user.email).toBe(deletedEmailFor(leaverId));

		const people = (await membersService.people(orgCtx)).map(toApiPerson);
		const row = present(
			people.find((p) => p.userId === leaverId),
			"the leaver in people",
		);
		expect(row.email).toBe(deletedEmailFor(leaverId));
		expect(at(people, 0)).toBeDefined();
	});

	test("a second run is safe and adds no row", async () => {
		const before = await db.query.auditEvent.findMany({
			where: eq(auditEvent.subjectUserId, leaverId),
		});
		await anonymiseService.anonymise(admin, leaverId);
		const after = await db.query.auditEvent.findMany({
			where: eq(auditEvent.subjectUserId, leaverId),
		});
		expect(after).toHaveLength(before.length);
		expect(
			(await db.query.user.findFirst({ where: eq(user.id, leaverId) }))?.email,
		).toBe(deletedEmailFor(leaverId));
	});
});
