// Team Lead people lists: who may read one, who may write one, and what the
// rows grant once `accessService.resolve` reads them back.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { client, project, projectMember } from "../db/schema/domain";
import { createTestDb, type TestDb } from "../test/harness";
import { AccessError, accessService } from "./access.service";
import { membersService } from "./members.service";
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

	// Both validation failures use the app's own error class, not a bare Error —
	// the same class `listPeople`'s "colleague" refusal already threw, so a
	// caller can distinguish "you did something wrong" from an unexpected crash
	// the same way everywhere in this file.
	test("both validation failures throw AccessError, not a bare Error", async () => {
		await expect(
			teamLeadsService.setPeople(ctx(ADMIN), {
				leadUserId: LEAD,
				personUserIds: [STRANGER],
			}),
		).rejects.toBeInstanceOf(AccessError);
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

describe("team lead lists refuse archived people", () => {
	const ARCHIVED_PERSON = "u-tl-archived-person";
	const ARCHIVED_LEAD = "u-tl-archived-lead";

	beforeAll(async () => {
		await db.insert(user).values(
			[ARCHIVED_PERSON, ARCHIVED_LEAD].map((id) => ({
				id,
				name: id,
				email: `${id}@example.com`,
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			})),
		);
		await db.insert(member).values(
			[ARCHIVED_PERSON, ARCHIVED_LEAD].map((id) => ({
				id: `m-${id}`,
				organizationId: ORG,
				userId: id,
				role: "member",
				createdAt: new Date(),
			})),
		);
		await membersService.setArchived(ctx(ADMIN), ARCHIVED_PERSON, true);
	});

	test("an archived person cannot be added to a list", async () => {
		await expect(
			teamLeadsService.setPeople(ctx(ADMIN), {
				leadUserId: LEAD,
				personUserIds: [ARCHIVED_PERSON],
			}),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("an archived person cannot be set as a lead", async () => {
		await membersService.setArchived(ctx(ADMIN), ARCHIVED_LEAD, true);
		await expect(
			teamLeadsService.setPeople(ctx(ADMIN), {
				leadUserId: ARCHIVED_LEAD,
				personUserIds: [ANA],
			}),
		).rejects.toBeInstanceOf(AccessError);
	});
});

describe("archiving or removing someone drops their team lead list rows", () => {
	const GONE_LEAD = "u-tl-gone-lead";
	const GONE_PERSON = "u-tl-gone-person";
	const OTHER_LEAD = "u-tl-other-lead";

	beforeAll(async () => {
		await db.insert(user).values(
			[GONE_LEAD, GONE_PERSON, OTHER_LEAD].map((id) => ({
				id,
				name: id,
				email: `${id}@example.com`,
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			})),
		);
		await db.insert(member).values(
			[GONE_LEAD, GONE_PERSON, OTHER_LEAD].map((id) => ({
				id: `m-${id}`,
				organizationId: ORG,
				userId: id,
				role: "member",
				createdAt: new Date(),
			})),
		);
	});

	test("removeFromAllLists drops rows where the person is lead or a listed person", async () => {
		await teamLeadsService.setPeople(ctx(ADMIN), {
			leadUserId: GONE_LEAD,
			personUserIds: [GONE_PERSON],
		});
		// GONE_PERSON is also on a second, unrelated lead's list.
		await teamLeadsService.setPeople(ctx(ADMIN), {
			leadUserId: OTHER_LEAD,
			personUserIds: [GONE_PERSON],
		});

		await teamLeadsService.removeFromAllLists(ctx(ADMIN), GONE_PERSON);

		expect(await teamLeadsService.listPeople(ctx(ADMIN), GONE_LEAD)).toEqual(
			[],
		);
		expect(await teamLeadsService.listPeople(ctx(ADMIN), OTHER_LEAD)).toEqual(
			[],
		);
	});

	test("archiving a lead drops the list they own, so a re-invite doesn't regain it", async () => {
		await teamLeadsService.setPeople(ctx(ADMIN), {
			leadUserId: GONE_LEAD,
			personUserIds: [ANA],
		});
		expect((await accessService.resolve(ctx(GONE_LEAD))).isTeamLead).toBe(true);

		await membersService.setArchived(ctx(ADMIN), GONE_LEAD, true);

		expect(await teamLeadsService.listPeople(ctx(ADMIN), GONE_LEAD)).toEqual(
			[],
		);
		await membersService.setArchived(ctx(ADMIN), GONE_LEAD, false);
		expect((await accessService.resolve(ctx(GONE_LEAD))).isTeamLead).toBe(
			false,
		);
	});
});

// The owner's decision on rank widening, exercised through the actual
// setPeople/resolve path rather than a hand-built Access — a people list
// gives PM rank only where the lead's OWN assignment is `team_lead`; a plain
// `member` assignment never widens.
describe("a people list widens PM rank only on a team_lead assignment", () => {
	const RANK_LEAD = "u-tl-rank-lead";
	const RANK_PERSON = "u-tl-rank-person";
	const RANK_COWORKER = "u-tl-rank-coworker";
	let teamLeadProjectId: string;
	let memberProjectId: string;

	beforeAll(async () => {
		await db.insert(user).values(
			[RANK_LEAD, RANK_PERSON, RANK_COWORKER].map((id) => ({
				id,
				name: id,
				email: `${id}@example.com`,
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			})),
		);
		await db.insert(member).values(
			[RANK_LEAD, RANK_PERSON, RANK_COWORKER].map((id) => ({
				id: `m-${id}`,
				organizationId: ORG,
				userId: id,
				role: "member",
				createdAt: new Date(),
			})),
		);
		const [rankClient] = await db
			.insert(client)
			.values({ organizationId: ORG, name: "Rank Client" })
			.returning();
		if (!rankClient) throw new Error("Failed to seed client");
		const [teamLeadProject, memberProject] = await db
			.insert(project)
			.values([
				{ organizationId: ORG, clientId: rankClient.id, name: "Rank TL" },
				{ organizationId: ORG, clientId: rankClient.id, name: "Rank Member" },
			])
			.returning();
		if (!teamLeadProject || !memberProject) {
			throw new Error("Failed to seed projects");
		}
		teamLeadProjectId = teamLeadProject.id;
		memberProjectId = memberProject.id;
		await db.insert(projectMember).values([
			{
				organizationId: ORG,
				projectId: teamLeadProjectId,
				userId: RANK_LEAD,
				role: "team_lead",
				active: true,
			},
			{
				organizationId: ORG,
				projectId: memberProjectId,
				userId: RANK_LEAD,
				role: "member",
				active: true,
			},
			{
				organizationId: ORG,
				projectId: memberProjectId,
				userId: RANK_COWORKER,
				role: "member",
				active: true,
			},
		]);
		await teamLeadsService.setPeople(ctx(ADMIN), {
			leadUserId: RANK_LEAD,
			personUserIds: [RANK_PERSON],
		});
	});

	test("PM on the team_lead assignment, member on the member assignment", async () => {
		const access = await accessService.resolve(ctx(RANK_LEAD));
		expect(access.heldAs(teamLeadProjectId)).toBe("pm");
		expect(access.canViewProjectMoney(teamLeadProjectId)).toBe(true);
		expect(access.canManageProject(teamLeadProjectId)).toBe(true);

		expect(access.heldAs(memberProjectId)).toBe("member");
		expect(access.canViewProjectMoney(memberProjectId)).toBe(false);
		expect(access.canManageProject(memberProjectId)).toBe(false);
	});

	test("peopleScope excludes the coworker on the member-rank project", async () => {
		const c = ctx(RANK_LEAD);
		const access = await accessService.resolve(c);
		const people = await accessService.peopleScope(c, access);
		expect(people).not.toBeNull();
		if (!people) throw new Error("expected a scoped, non-admin answer");
		expect(people.has(RANK_PERSON)).toBe(true);
		expect(people.has(RANK_COWORKER)).toBe(false);
	});
});
