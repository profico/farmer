// A Harvest import's pending claim, from the side of the person it names.
//
// The import makes a `member` row for an address that had no account, and the
// real owner of that address may sign in later. Until they accept, the
// membership is the organization's history and not the person's workspace:
// every surface that asks "may they open it" says no, and reminders stay
// quiet. These tests pin that, and pin what Join and Decline leave behind.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { account, member, organization, user } from "../db/schema/auth";
import { task, timeEntry } from "../db/schema/domain";
import { memberProfile } from "../db/schema/people";
import { createTestDb, present, type TestDb } from "../test/harness";
import { accessService, NotAMemberError } from "./access.service";
import {
	importClaimsService,
	NoPendingClaimError,
} from "./import-claims.service";
import { membersService } from "./members.service";
import { deliveryBlocks } from "./notify";
import { orgContextService } from "./org-context.service";

const ORG = "org-claims";
const HOME = "org-claims-home";
const ADMIN = "u-claims-admin";
const CLAIMANT = "u-claims-claimant";
const DECLINER = "u-claims-decliner";
const PLAIN = "u-claims-plain";

let harness: TestDb;

const ctx = (userId: string, organizationId = ORG) => ({
	organizationId,
	userId,
});

const memberRow = (userId: string, organizationId = ORG) =>
	db.query.member.findFirst({
		where: and(
			eq(member.organizationId, organizationId),
			eq(member.userId, userId),
		),
	});

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{ id: ORG, name: "Importer", slug: "importer", createdAt: new Date() },
		{ id: HOME, name: "Home", slug: "home", createdAt: new Date() },
	]);
	await db.insert(user).values(
		[ADMIN, CLAIMANT, DECLINER, PLAIN].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(member).values([
		{
			id: "m-admin",
			organizationId: ORG,
			userId: ADMIN,
			role: "owner",
			createdAt: new Date(),
		},
		{
			id: "m-claimant",
			organizationId: ORG,
			userId: CLAIMANT,
			role: "member",
			createdAt: new Date("2026-01-01T00:00:00Z"),
		},
		// The claimant's own workspace, joined later than the import's row.
		{
			id: "m-claimant-home",
			organizationId: HOME,
			userId: CLAIMANT,
			role: "owner",
			createdAt: new Date("2026-02-01T00:00:00Z"),
		},
		{
			id: "m-decliner",
			organizationId: ORG,
			userId: DECLINER,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "m-plain",
			organizationId: ORG,
			userId: PLAIN,
			role: "member",
			createdAt: new Date(),
		},
	]);
	const since = new Date("2026-09-01T00:00:00Z");
	await db.insert(memberProfile).values([
		{ organizationId: ORG, userId: CLAIMANT, claimPendingSince: since },
		{ organizationId: ORG, userId: DECLINER, claimPendingSince: since },
		{ organizationId: ORG, userId: PLAIN },
	]);
	// Both pending people have signed in: that is how a claim is met. Without
	// the `account` row the reminder gate would say "never signed in" first.
	await db.insert(account).values(
		[CLAIMANT, DECLINER, PLAIN].map((userId) => ({
			id: `acc-${userId}`,
			accountId: userId,
			providerId: "google",
			userId,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	// The history the import brought in for the decliner.
	const meeting = present(
		await db.query.task.findFirst({ where: eq(task.systemKey, "meeting") }),
		"the Meeting site task",
	);
	await db.insert(timeEntry).values({
		organizationId: ORG,
		userId: DECLINER,
		taskId: meeting.id,
		date: "2025-03-04",
		description: "imported",
		durationSeconds: 3_600,
	});
});

afterAll(async () => {
	await harness.close();
});

describe("a pending claim is not a membership for the person", () => {
	test("accessService.resolve refuses the caller", async () => {
		await expect(accessService.resolve(ctx(CLAIMANT))).rejects.toBeInstanceOf(
			NotAMemberError,
		);
	});

	test("getRole and resolveBySlug answer as for a non-member", async () => {
		expect(await membersService.getRole(ctx(CLAIMANT))).toBe(null);
		expect(await orgContextService.resolveBySlug(CLAIMANT, "importer")).toBe(
			null,
		);
	});

	test("organizationsFor leaves the organization out", async () => {
		expect(
			(await orgContextService.organizationsFor(CLAIMANT)).map((o) => o.slug),
		).toEqual(["home"]);
	});

	test("the organization still sees the person, marked as not joined", async () => {
		const people = await membersService.list(ctx(ADMIN));
		const claimant = present(
			people.find((p) => p.userId === CLAIMANT),
			"the claimant on People",
		);
		expect(claimant.claimPending).toBe(true);
	});

	test("pendingFor lists the claim", async () => {
		expect(await importClaimsService.pendingFor(CLAIMANT)).toEqual([
			{
				organizationId: ORG,
				name: "Importer",
				slug: "importer",
				logo: null,
				since: new Date("2026-09-01T00:00:00Z"),
			},
		]);
		expect(await importClaimsService.pendingFor(PLAIN)).toEqual([]);
	});

	test("deliveryBlocks holds every kind back", async () => {
		for (const kind of ["log-reminder", "test"] as const) {
			const blocks = await deliveryBlocks(ORG, [CLAIMANT, PLAIN], kind);
			expect(blocks.get(CLAIMANT)).toBe("claim-pending");
			expect(blocks.has(PLAIN)).toBe(false);
		}
	});
});

describe("accept and decline", () => {
	test("both refuse a caller with no pending claim", async () => {
		await expect(importClaimsService.accept(ctx(PLAIN))).rejects.toBeInstanceOf(
			NoPendingClaimError,
		);
		await expect(
			importClaimsService.decline(ctx(PLAIN)),
		).rejects.toBeInstanceOf(NoPendingClaimError);
		// Nor for an organization the caller has no row in at all.
		await expect(
			importClaimsService.accept(ctx(PLAIN, HOME)),
		).rejects.toBeInstanceOf(NoPendingClaimError);
		expect(await memberRow(PLAIN)).toBeDefined();
	});

	test("accept makes the membership the person's own", async () => {
		expect(await importClaimsService.accept(ctx(CLAIMANT))).toEqual({
			slug: "importer",
		});

		const access = await accessService.resolve(ctx(CLAIMANT));
		expect(access.isAdmin).toBe(false);
		expect(await membersService.getRole(ctx(CLAIMANT))).toBe("member");
		const joined = (await membersService.list(ctx(ADMIN))).find(
			(p) => p.userId === CLAIMANT,
		);
		expect(joined?.claimPending).toBe(false);
		expect(
			(await orgContextService.organizationsFor(CLAIMANT)).map((o) => o.slug),
		).toEqual(["importer", "home"]);
		expect(await importClaimsService.pendingFor(CLAIMANT)).toEqual([]);
		const blocks = await deliveryBlocks(ORG, [CLAIMANT], "log-reminder");
		expect(blocks.has(CLAIMANT)).toBe(false);

		// Answered once: a second accept has nothing to accept.
		await expect(
			importClaimsService.accept(ctx(CLAIMANT)),
		).rejects.toBeInstanceOf(NoPendingClaimError);
	});

	test("decline removes the member row and keeps the history", async () => {
		await importClaimsService.decline(ctx(DECLINER));

		expect(await memberRow(DECLINER)).toBeUndefined();
		const profile = present(
			await db.query.memberProfile.findFirst({
				where: and(
					eq(memberProfile.organizationId, ORG),
					eq(memberProfile.userId, DECLINER),
				),
			}),
			"the decliner's profile",
		);
		expect(profile.claimPendingSince).toBe(null);
		const entries = await db
			.select({ id: timeEntry.id })
			.from(timeEntry)
			.where(
				and(eq(timeEntry.organizationId, ORG), eq(timeEntry.userId, DECLINER)),
			);
		expect(entries).toHaveLength(1);

		await expect(importClaimsService.pendingFor(DECLINER)).resolves.toEqual([]);
		await expect(accessService.resolve(ctx(DECLINER))).rejects.toBeInstanceOf(
			NotAMemberError,
		);
		await expect(
			importClaimsService.decline(ctx(DECLINER)),
		).rejects.toBeInstanceOf(NoPendingClaimError);
	});
});
