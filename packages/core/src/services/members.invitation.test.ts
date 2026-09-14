// `membersService.pendingInvitation`: what a resend looks up. better-auth
// resends by address, so this turns the list's invitation id back into the
// address and role — and must refuse anything that is not a pending invitation
// of the caller's own org, since the id arrives from the browser.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db } from "../db";
import { invitation, member, organization, user } from "../db/schema/auth";
import { createTestDb, type TestDb } from "../test/harness";
import { membersService } from "./members.service";
import type { Ctx } from "./types";

const ORG = "mi-org";
const OTHER_ORG = "mi-other-org";
const ADMIN = "u-mi-admin";
const MEMBER = "u-mi-member";

let harness: TestDb;

const ctx = (userId: string, organizationId = ORG): Ctx => ({
	organizationId,
	userId,
});

beforeAll(async () => {
	harness = await createTestDb();
	const now = new Date();
	const later = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

	await db.insert(organization).values([
		{ id: ORG, name: "Invites", slug: ORG, createdAt: now },
		{ id: OTHER_ORG, name: "Elsewhere", slug: OTHER_ORG, createdAt: now },
	]);
	await db.insert(user).values(
		[ADMIN, MEMBER].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		})),
	);
	await db.insert(member).values([
		{
			id: "m-mi-admin",
			organizationId: ORG,
			userId: ADMIN,
			role: "owner",
			createdAt: now,
		},
		{
			id: "m-mi-member",
			organizationId: ORG,
			userId: MEMBER,
			role: "member",
			createdAt: now,
		},
		{
			id: "m-mi-other",
			organizationId: OTHER_ORG,
			userId: ADMIN,
			role: "owner",
			createdAt: now,
		},
	]);
	await db.insert(invitation).values([
		{
			id: "inv-pending",
			organizationId: ORG,
			email: "ben@example.com",
			role: "admin",
			status: "pending",
			expiresAt: later,
			inviterId: ADMIN,
		},
		{
			id: "inv-canceled",
			organizationId: ORG,
			email: "gone@example.com",
			role: "member",
			status: "canceled",
			expiresAt: later,
			inviterId: ADMIN,
		},
		{
			id: "inv-other-org",
			organizationId: OTHER_ORG,
			email: "far@example.com",
			role: "member",
			status: "pending",
			expiresAt: later,
			inviterId: ADMIN,
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("membersService.pendingInvitation", () => {
	test("returns the address and role of a pending invitation", async () => {
		expect(
			await membersService.pendingInvitation(ctx(ADMIN), "inv-pending"),
		).toEqual({ email: "ben@example.com", role: "admin" });
	});

	test("is null for an invitation that is no longer pending", async () => {
		expect(
			await membersService.pendingInvitation(ctx(ADMIN), "inv-canceled"),
		).toBeNull();
	});

	test("is null for another org's invitation", async () => {
		expect(
			await membersService.pendingInvitation(ctx(ADMIN), "inv-other-org"),
		).toBeNull();
	});

	test("refuses a caller who is not an admin", async () => {
		await expect(
			membersService.pendingInvitation(ctx(MEMBER), "inv-pending"),
		).rejects.toThrow(/admin/i);
	});
});
