// The only owner of an organization cannot be archived or have the address
// confirmed through the service. The People page hides both acts for that row;
// the REST routes call the service directly, so the service must refuse.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { createTestDb, type TestDb } from "../test/harness";
import { membersService } from "./members.service";
import type { Ctx } from "./types";

const ORG = "oo-org";
const OWNER = "u-oo-owner";
const OWNER_TWO = "u-oo-owner-two";
const ADMIN = "u-oo-admin";

let harness: TestDb;

const ctx = (userId: string): Ctx => ({ organizationId: ORG, userId });

beforeAll(async () => {
	harness = await createTestDb();
	const now = new Date();
	await db
		.insert(organization)
		.values({ id: ORG, name: "Owners", slug: ORG, createdAt: now });
	await db.insert(user).values(
		[OWNER, OWNER_TWO, ADMIN].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: false,
			createdAt: now,
			updatedAt: now,
		})),
	);
	await db.insert(member).values([
		{
			id: "m-oo-owner",
			organizationId: ORG,
			userId: OWNER,
			role: "owner",
			createdAt: now,
		},
		{
			id: "m-oo-admin",
			organizationId: ORG,
			userId: ADMIN,
			role: "admin",
			createdAt: now,
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("the only owner", () => {
	test("an admin cannot archive the only owner", async () => {
		await expect(
			membersService.setArchived(ctx(ADMIN), OWNER, true),
		).rejects.toThrow("You cannot archive the only owner");
	});

	test("an admin cannot confirm the address of the only owner", async () => {
		await expect(
			membersService.confirmEmail(ctx(ADMIN), OWNER),
		).rejects.toThrow("You cannot confirm the address of the only owner");
	});

	test("an admin can archive an admin who is not an owner", async () => {
		const owner = ctx(OWNER);
		await expect(
			membersService.setArchived(owner, ADMIN, true),
		).resolves.toEqual({ emailConfirmed: false });
	});

	test("with two owners, an admin can archive one", async () => {
		const now = new Date();
		await db.insert(member).values({
			id: "m-oo-owner-two",
			organizationId: ORG,
			userId: OWNER_TWO,
			role: "owner",
			createdAt: now,
		});
		await expect(
			membersService.setArchived(ctx(OWNER), OWNER_TWO, true),
		).resolves.toEqual({ emailConfirmed: false });
	});

	test("an archived owner does not count as an owner", async () => {
		await expect(
			membersService.setArchived(ctx(ADMIN), OWNER, true),
		).rejects.toThrow("You cannot archive the only owner");
		await expect(
			membersService.confirmEmail(ctx(ADMIN), OWNER),
		).rejects.toThrow("You cannot confirm the address of the only owner");
	});
});
