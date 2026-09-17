// The people lists: `roster` (the People screen), `directory` (every avatar)
// and `list` (the personnel record), plus the admin-only edits beside them.
//
// `roster` replaced better-auth's `listMembers`, which read members with a
// limit and their users without one, so the adapter's default of 100 threw
// "User not found for member" in any org over a hundred people — which a
// Harvest import makes in one go. The org here has 150 people for that reason.
//
// Role changes and the last-owner rule are better-auth's (`updateMemberRole`
// over HTTP) and have no service function to test here.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { account, member, organization, user } from "../db/schema/auth";
import { memberProfile, memberTypeHistory } from "../db/schema/people";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import { membersService } from "./members.service";
import type { Ctx } from "./types";

const ORG_A = "mr-a";

const ORG_B = "mr-b";

const ADMIN = "u-mr-admin";

const B_ONLY = "u-mr-b-only";

const UNVERIFIED_NEVER = "u-mr-unverified-never";

const UNVERIFIED_SIGNED_IN = "u-mr-unverified-signed-in";

const FUTURE_CONTRACTOR = "u-mr-future";

const PAST_CONTRACTOR = "u-mr-past";

const CROWD_SIZE = 150;

const crowd = Array.from(
	{ length: CROWD_SIZE },
	(_, i) => `u-mr-p${String(i).padStart(3, "0")}`,
);

const PLAIN = at(crowd, 0);

/** Everyone in org A: the admin, the crowd and the four special cases. */
const ORG_A_PEOPLE = [
	ADMIN,
	...crowd,
	UNVERIFIED_NEVER,
	UNVERIFIED_SIGNED_IN,
	FUTURE_CONTRACTOR,
	PAST_CONTRACTOR,
];

let harness: TestDb;

const ctx = (userId: string, organizationId: string = ORG_A): Ctx => ({
	organizationId,
	userId,
});

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{ id: ORG_A, name: "Roster A", slug: ORG_A, createdAt: new Date() },
		{ id: ORG_B, name: "Roster B", slug: ORG_B, createdAt: new Date() },
	]);

	await db.insert(user).values(
		[...ORG_A_PEOPLE, B_ONLY].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: id !== UNVERIFIED_NEVER && id !== UNVERIFIED_SIGNED_IN,
			image: `https://img.example.com/${id}.png`,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	// Distinct, increasing join times, so "oldest first" has one right answer.
	const base = Date.UTC(2025, 0, 1);
	await db.insert(member).values([
		...ORG_A_PEOPLE.map((id, i) => ({
			id: `m-a-${id}`,
			organizationId: ORG_A,
			userId: id,
			role: id === ADMIN ? "owner" : "member",
			createdAt: new Date(base + i * 60_000),
		})),
		// The admin of A is a plain member of B; B_ONLY is in B alone.
		{
			id: `m-b-${ADMIN}`,
			organizationId: ORG_B,
			userId: ADMIN,
			role: "member",
			createdAt: new Date(base),
		},
		{
			id: `m-b-${B_ONLY}`,
			organizationId: ORG_B,
			userId: B_ONLY,
			role: "admin",
			createdAt: new Date(base),
		},
	]);

	// Signed in once (an account row), but the address was never verified.
	await db.insert(account).values({
		id: "acc-mr-signed-in",
		accountId: "g-signed-in",
		providerId: "google",
		userId: UNVERIFIED_SIGNED_IN,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	await db.insert(memberTypeHistory).values([
		// A change dated ahead opens the future segment now; `list` must not
		// report it as today's type.
		{
			organizationId: ORG_A,
			userId: FUTURE_CONTRACTOR,
			type: "contractor_hourly" as const,
			effectiveFrom: "2999-01-01",
		},
		{
			organizationId: ORG_A,
			userId: PAST_CONTRACTOR,
			type: "contractor_hourly" as const,
			effectiveFrom: "2020-01-01",
		},
		// Same person, other org: invisible to org A's history.
		{
			organizationId: ORG_B,
			userId: ADMIN,
			type: "employee_overhead" as const,
			effectiveFrom: "2020-01-01",
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("roster", () => {
	test("returns every member of an org over 100 people, and only that org", async () => {
		const { members } = await membersService.roster(ctx(PLAIN));
		expect(members).toHaveLength(ORG_A_PEOPLE.length);
		expect(members.map((m) => m.userId)).not.toContain(B_ONLY);
	});

	test("oldest first, in the shape the People screen draws", async () => {
		const { members } = await membersService.roster(ctx(PLAIN));
		expect(members.map((m) => m.userId)).toEqual(ORG_A_PEOPLE);
		expect(at(members, 0)).toEqual({
			id: `m-a-${ADMIN}`,
			userId: ADMIN,
			role: "owner",
			createdAt: expect.any(Date),
			user: {
				id: ADMIN,
				name: ADMIN,
				email: `${ADMIN}@example.com`,
				image: `https://img.example.com/${ADMIN}.png`,
			},
		});
	});

	test("the role is the one held in the caller's org", async () => {
		const { members } = await membersService.roster(ctx(B_ONLY, ORG_B));
		expect(members.map((m) => [m.userId, m.role]).sort()).toEqual(
			[
				[ADMIN, "member"],
				[B_ONLY, "admin"],
			].sort(),
		);
	});
});

describe("directory", () => {
	test("names and faces for the whole org, and nothing a personnel record owns", async () => {
		const entries = await membersService.directory(ctx(PLAIN));
		expect(entries).toHaveLength(ORG_A_PEOPLE.length);

		for (const entry of entries) {
			expect(Object.keys(entry).sort()).toEqual(["image", "name", "userId"]);
		}

		expect(entries.map((e) => e.userId)).not.toContain(B_ONLY);
	});
});

describe("list", () => {
	test("every member of an org over 100 people, with the default type", async () => {
		const rows = await membersService.list(ctx(ADMIN));
		expect(rows).toHaveLength(ORG_A_PEOPLE.length);

		const plain = present(
			rows.find((r) => r.userId === PLAIN),
			"plain member",
		);

		expect(plain).toMatchObject({
			type: "employee_billable",
			expectedSecondsOverride: null,
			orgRole: "member",
			archivedAt: null,
			emailUnconfirmed: false,
		});
	});

	test("an unverified address is unconfirmed only until the person signs in", async () => {
		const rows = await membersService.list(ctx(ADMIN));
		const byId = new Map(rows.map((r) => [r.userId, r]));
		expect(
			present(byId.get(UNVERIFIED_NEVER), "never signed in").emailUnconfirmed,
		).toBe(true);
		expect(
			present(byId.get(UNVERIFIED_SIGNED_IN), "signed in").emailUnconfirmed,
		).toBe(false);
	});

	test("reports today's type, not a change dated ahead", async () => {
		const rows = await membersService.list(ctx(ADMIN));
		const byId = new Map(rows.map((r) => [r.userId, r]));
		expect(present(byId.get(FUTURE_CONTRACTOR), "future").type).toBe(
			"employee_billable",
		);
		expect(present(byId.get(PAST_CONTRACTOR), "past").type).toBe(
			"contractor_hourly",
		);
	});

	test("another org's type segment for the same person does not leak in", async () => {
		const rows = await membersService.list(ctx(ADMIN));
		expect(
			present(
				rows.find((r) => r.userId === ADMIN),
				"admin",
			).type,
		).toBe("employee_billable");
	});
});

describe("getRole", () => {
	test("the role in the Ctx's org, or null for a non-member", async () => {
		expect(await membersService.getRole(ctx(ADMIN))).toBe("owner");
		expect(await membersService.getRole(ctx(ADMIN, ORG_B))).toBe("member");
		expect(await membersService.getRole(ctx(B_ONLY))).toBeNull();
	});
});

describe("typeHistory", () => {
	test("Admin-only", async () => {
		await expect(
			membersService.typeHistory(ctx(PLAIN), PAST_CONTRACTOR),
		).rejects.toThrow(AccessError);
		// An owner of A is only a member of B, and is refused there.
		await expect(
			membersService.typeHistory(ctx(ADMIN, ORG_B), ADMIN),
		).rejects.toThrow(AccessError);
	});

	test("only the caller's org's segments", async () => {
		expect(await membersService.typeHistory(ctx(ADMIN), ADMIN)).toEqual([]);
		const past = await membersService.typeHistory(ctx(ADMIN), PAST_CONTRACTOR);
		expect(past.map((r) => r.type)).toEqual(["contractor_hourly"]);
	});
});

describe("setStartDate", () => {
	test("Admin-only", async () => {
		await expect(
			membersService.setStartDate(ctx(PLAIN), PLAIN, "2024-01-01"),
		).rejects.toThrow(AccessError);
	});

	test("an admin sets a member's start date and list shows it", async () => {
		await membersService.setStartDate(ctx(ADMIN), PLAIN, "2024-03-01");
		const rows = await membersService.list(ctx(ADMIN));
		expect(
			present(
				rows.find((r) => r.userId === PLAIN),
				"plain",
			).startDate,
		).toBe("2024-03-01");
	});

	test("a person outside the org is refused and no profile row is made", async () => {
		await expect(
			membersService.setStartDate(ctx(ADMIN), B_ONLY, "2024-01-01"),
		).rejects.toThrow("That person is not a member of this organization");

		const rows = await db.query.memberProfile.findMany({
			where: and(
				eq(memberProfile.organizationId, ORG_A),
				eq(memberProfile.userId, B_ONLY),
			),
		});

		expect(rows).toHaveLength(0);
	});
});
