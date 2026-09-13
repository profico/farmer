// Team Lead people lists: who may read one, who may write one, and what the
// rows grant once `accessService.resolve` reads them back.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { createTestDb, type TestDb } from "../test/harness";
import { AccessError, accessService } from "./access.service";
import { teamLeadsService } from "./team-leads.service";
import type { Ctx } from "./types";

const ORG = "org-team-leads";
const OTHER_ORG = "org-team-leads-other";
const ADMIN = "u-tl-admin";
const LEAD = "u-tl-lead";
const ANA = "u-tl-ana";
const BOB = "u-tl-bob";
const STRANGER = "u-tl-stranger";

const ctx = (userId: string): Ctx => ({ organizationId: ORG, userId });

let harness: TestDb;

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values([
		{ id: ORG, name: "Leads", slug: ORG, createdAt: new Date() },
		{ id: OTHER_ORG, name: "Other", slug: OTHER_ORG, createdAt: new Date() },
	]);
	await db.insert(user).values(
		[ADMIN, LEAD, ANA, BOB, STRANGER].map((id) => ({
			id,
			name: id.replace("u-tl-", ""),
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(member).values([
		...[ADMIN, LEAD, ANA, BOB].map((id) => ({
			id: `m-${id}`,
			organizationId: ORG,
			userId: id,
			role: id === ADMIN ? "admin" : "member",
			createdAt: new Date(),
		})),
		{
			id: `m-${STRANGER}`,
			organizationId: OTHER_ORG,
			userId: STRANGER,
			role: "member",
			createdAt: new Date(),
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("team lead people lists", () => {
	test("an admin sets the list; the lead and the admin read it back, alphabetical", async () => {
		const set = await teamLeadsService.setPeople(ctx(ADMIN), {
			leadUserId: LEAD,
			// The lead's own id and a duplicate are dropped rather than refused.
			personUserIds: [BOB, ANA, LEAD, ANA],
		});
		expect(set.map((p) => p.userId)).toEqual([ANA, BOB]);
		expect(
			(await teamLeadsService.listPeople(ctx(LEAD), LEAD)).map((p) => p.name),
		).toEqual(["ana", "bob"]);
		expect(await teamLeadsService.countsByLead(ctx(ADMIN))).toEqual(
			new Map([[LEAD, 2]]),
		);
	});

	test("the rows are what make a Team Lead", async () => {
		const access = await accessService.resolve(ctx(LEAD));
		expect(access.isTeamLead).toBe(true);
		expect(access.peopleLed().sort()).toEqual([ANA, BOB]);
		expect(access.canViewPerson(ANA)).toBe(true);
		expect(access.canViewPerson(ADMIN)).toBe(false);
		expect((await accessService.resolve(ctx(ANA))).isTeamLead).toBe(false);
	});

	test("a colleague cannot read the list, and nobody but an admin writes it", async () => {
		await expect(teamLeadsService.listPeople(ctx(ANA), LEAD)).rejects.toThrow(
			AccessError,
		);
		await expect(
			teamLeadsService.setPeople(ctx(LEAD), {
				leadUserId: LEAD,
				personUserIds: [ANA],
			}),
		).rejects.toThrow(AccessError);
	});

	test("everyone named must be a member of this workspace", async () => {
		await expect(
			teamLeadsService.setPeople(ctx(ADMIN), {
				leadUserId: LEAD,
				personUserIds: [STRANGER],
			}),
		).rejects.toThrow("member of this workspace");
		await expect(
			teamLeadsService.setPeople(ctx(ADMIN), {
				leadUserId: STRANGER,
				personUserIds: [ANA],
			}),
		).rejects.toThrow("member of this workspace");
	});

	test("the list is replaced wholesale, and an empty list ends the lead", async () => {
		await teamLeadsService.setPeople(ctx(ADMIN), {
			leadUserId: LEAD,
			personUserIds: [BOB],
		});
		expect(
			(await teamLeadsService.listPeople(ctx(ADMIN), LEAD)).map(
				(p) => p.userId,
			),
		).toEqual([BOB]);
		await teamLeadsService.setPeople(ctx(ADMIN), {
			leadUserId: LEAD,
			personUserIds: [],
		});
		expect((await accessService.resolve(ctx(LEAD))).isTeamLead).toBe(false);
		expect(await teamLeadsService.countsByLead(ctx(ADMIN))).toEqual(new Map());
	});
});
