// The admin reads behind the REST API's People and workspace routes.
//
// The web app keeps these reads behind `orgAdminMiddleware`. A REST route has
// no such middleware, so each service checks the role itself, and these tests
// pin that: an admin reads, a member gets an `AccessError`, and nothing of
// another organization comes back. The last test runs the projects list
// through the projection the route uses, as a member sees it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { toApiProjectDetail } from "../api/project-admin";
import { db } from "../db";
import { invitation, member, organization, user } from "../db/schema/auth";
import { client, project, projectMember, timeEntry } from "../db/schema/domain";
import { teamLeadPerson } from "../db/schema/people";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import { hourFundService } from "./hour-fund.service";
import { membersService } from "./members.service";
import { organizationService } from "./organization.service";
import { projectsService } from "./projects.service";
import { tasksService } from "./tasks.service";
import type { Ctx } from "./types";

const ORG = "ar-org";
const OTHER = "ar-other";
const ADMIN = "u-ar-admin";
const LEAD = "u-ar-lead";
const MEMBER = "u-ar-member";
const STRANGER = "u-ar-stranger";

let harness: TestDb;

/** A fresh Ctx per call: `ctxAccess` memoizes Access on the object. */
const ctx = (userId: string, organizationId = ORG): Ctx => ({
	organizationId,
	userId,
});

beforeAll(async () => {
	harness = await createTestDb();
	const now = new Date();
	await db.insert(organization).values([
		{ id: ORG, name: "Reads", slug: ORG, createdAt: now },
		{ id: OTHER, name: "Elsewhere", slug: OTHER, createdAt: now },
	]);
	await db.insert(user).values(
		[ADMIN, LEAD, MEMBER, STRANGER].map((id) => ({
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
			id: "m-ar-admin",
			organizationId: ORG,
			userId: ADMIN,
			role: "admin",
			createdAt: now,
		},
		{
			id: "m-ar-lead",
			organizationId: ORG,
			userId: LEAD,
			role: "member",
			createdAt: now,
		},
		{
			id: "m-ar-member",
			organizationId: ORG,
			userId: MEMBER,
			role: "member",
			createdAt: now,
		},
		{
			id: "m-ar-stranger",
			organizationId: OTHER,
			userId: STRANGER,
			role: "owner",
			createdAt: now,
		},
	]);
	await db.insert(teamLeadPerson).values({
		organizationId: ORG,
		leadUserId: LEAD,
		personUserId: MEMBER,
	});
	const later = new Date(now.getTime() + 7 * 86_400_000);
	await db.insert(invitation).values([
		{
			id: "i-ar-here",
			organizationId: ORG,
			email: "here@example.com",
			role: "member",
			status: "pending",
			expiresAt: later,
			inviterId: ADMIN,
			createdAt: now,
		},
		{
			id: "i-ar-done",
			organizationId: ORG,
			email: "done@example.com",
			role: "member",
			status: "accepted",
			expiresAt: later,
			inviterId: ADMIN,
			createdAt: now,
		},
		{
			id: "i-ar-there",
			organizationId: OTHER,
			email: "there@example.com",
			role: "member",
			status: "pending",
			expiresAt: later,
			inviterId: STRANGER,
			createdAt: now,
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("the admin reads", () => {
	const reads: [string, (caller: Ctx) => Promise<object>][] = [
		["people", (caller) => membersService.people(caller)],
		["profile", (caller) => membersService.profile(caller, MEMBER)],
		["invitations", (caller) => membersService.listInvitations(caller)],
		["hour fund", (caller) => hourFundService.listForYear(caller, 2026)],
		[
			"hour fund suggestion",
			(caller) => hourFundService.suggestForMonth(caller, 2026, 10),
		],
		["organization", (caller) => organizationService.getSettings(caller)],
		["managed tasks", (caller) => tasksService.listManaged(caller)],
	];

	for (const [name, read] of reads) {
		test(`${name}: an admin reads, a member and a team lead do not`, async () => {
			expect(await read(ctx(ADMIN))).toBeDefined();
			await expect(read(ctx(MEMBER))).rejects.toBeInstanceOf(AccessError);
			await expect(read(ctx(LEAD))).rejects.toBeInstanceOf(AccessError);
		});
	}
});

describe("what the admin reads answer", () => {
	test("the profile names the person's team lead list", async () => {
		const profile = await membersService.profile(ctx(ADMIN), LEAD);
		expect(profile.person.userId).toBe(LEAD);
		expect(profile.leads.map((row) => row.userId)).toEqual([MEMBER]);
	});

	test("a person of another organization is not found", async () => {
		await expect(membersService.profile(ctx(ADMIN), STRANGER)).rejects.toThrow(
			"Person not found",
		);
	});

	test("the invitations are this organization's pending ones", async () => {
		const rows = await membersService.listInvitations(ctx(ADMIN));
		expect(rows.map((row) => row.id)).toEqual(["i-ar-here"]);
		expect(at(rows, 0).emailDelivery).toBeNull();
	});
});

describe("the projects list as a member reads it", () => {
	test("no money, and only the member's own hours", async () => {
		const [acme] = await db
			.insert(client)
			.values({ organizationId: ORG, name: "Acme" })
			.returning();
		const [site] = await db
			.insert(project)
			.values({
				organizationId: ORG,
				clientId: present(acme, "client").id,
				name: "Site",
				type: "fixed_scope",
				budgetSeconds: 360_000,
				budgetAmount: "15000.00",
			})
			.returning();
		const projectId = present(site, "project").id;
		await db.insert(projectMember).values([
			{ organizationId: ORG, projectId, userId: MEMBER, role: "member" },
			{ organizationId: ORG, projectId, userId: LEAD, role: "pm" },
		]);
		const today = new Date().toISOString().slice(0, 10);
		const tasks = await tasksService.listSelectable(ctx(ADMIN));
		const taskId = at(tasks, 0).id;
		await db.insert(timeEntry).values([
			{
				organizationId: ORG,
				userId: MEMBER,
				projectId,
				taskId,
				date: today,
				durationSeconds: 3600,
				description: "Mine",
			},
			{
				organizationId: ORG,
				userId: LEAD,
				projectId,
				taskId,
				date: today,
				durationSeconds: 7200,
				description: "The PM's",
			},
		]);

		const asMember = (await projectsService.list(ctx(MEMBER))).map(
			toApiProjectDetail,
		);
		const mine = present(
			asMember.find((row) => row.id === projectId),
			"the member's project",
		);
		expect(mine.budgetSeconds).toBeNull();
		expect(mine.budgetAmount).toBeNull();
		expect(mine.stats).toEqual({
			scope: "own",
			monthSeconds: 3600,
			allTimeSeconds: 3600,
			contributorCount: 0,
			contributors: [],
		});

		const asPm = (await projectsService.list(ctx(LEAD))).map(
			toApiProjectDetail,
		);
		const theirs = present(
			asPm.find((row) => row.id === projectId),
			"the PM's project",
		);
		expect(theirs.budgetAmount).toBe("15000.00");
		expect(theirs.stats.scope).toBe("project");
		expect(theirs.stats.allTimeSeconds).toBe(10_800);
	});
});
