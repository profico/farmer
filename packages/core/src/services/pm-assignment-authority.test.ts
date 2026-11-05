// A PM may assign people to a project, but only an assignment that an Admin
// made gives the PM authority over that person's absence and people scope.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { client, project, projectMember, task } from "../db/schema/domain";
import { createTestDb, present, type TestDb } from "../test/harness";
import { accessService } from "./access.service";
import { projectsService } from "./projects.service";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG = "org-pm-authority";
const OWNER = "u-pa-owner";
const PM = "u-pa-pm";
const BOB = "u-pa-bob";
const OLD = "u-pa-old";

/** Fresh per call: Access is memoized on the Ctx object. */
const ctx = (userId: string): Ctx => ({ organizationId: ORG, userId });

let harness: TestDb;
let projectId = "";

const absenceOf = (caller: string, userId: string) =>
	timeEntriesService.listAbsenceForUser(ctx(caller), {
		userId,
		year: 2026,
		month: 8,
	});

const flagOf = async (userId: string) =>
	present(
		await db.query.projectMember.findFirst({
			where: and(
				eq(projectMember.projectId, projectId),
				eq(projectMember.userId, userId),
			),
		}),
		"assignment",
	).assignedByAdmin;

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values({
		id: ORG,
		name: "PM Authority",
		slug: ORG,
		createdAt: new Date(),
	});
	const ids = [OWNER, PM, BOB, OLD];
	await db.insert(user).values(
		ids.map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(member).values(
		ids.map((id) => ({
			id: `m-${id}`,
			organizationId: ORG,
			userId: id,
			role: id === OWNER ? "owner" : "member",
			createdAt: new Date(),
		})),
	);
	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG, name: "Client" })
		.returning();
	const [p] = await db
		.insert(project)
		.values({
			organizationId: ORG,
			clientId: present(c, "client").id,
			name: "Q",
		})
		.returning();
	projectId = present(p, "project").id;
	// The owner makes the PM's assignment.
	await projectsService.assignMember(ctx(OWNER), {
		projectId,
		userId: PM,
		role: "pm",
	});
	// A row from before the column existed takes the column default.
	await db.insert(projectMember).values({
		organizationId: ORG,
		projectId,
		userId: OLD,
		role: "member",
	});
});

afterAll(async () => {
	await harness.close();
});

describe("a PM's assignment and authority over a person", () => {
	test("a row from before the column keeps the PM's access", async () => {
		expect(await flagOf(OLD)).toBe(true);
		expect(await absenceOf(PM, OLD)).toEqual([]);
	});

	test("a PM assigns the owner and gets no access to their absence", async () => {
		await projectsService.assignMember(ctx(PM), {
			projectId,
			userId: OWNER,
			role: "member",
		});
		await expect(absenceOf(PM, OWNER)).rejects.toThrow("cannot see");
		const scope = present(
			await accessService.peopleScope(
				ctx(PM),
				await accessService.resolve(ctx(PM)),
			),
			"scope",
		);
		expect(scope.has(OWNER)).toBe(false);
	});

	test("a person the PM assigned is out of reach", async () => {
		await projectsService.assignMember(ctx(PM), {
			projectId,
			userId: BOB,
			role: "member",
		});
		expect(await flagOf(BOB)).toBe(false);
		await expect(absenceOf(PM, BOB)).rejects.toThrow("cannot see");
		await expect(
			timeEntriesService.createAbsenceForUser(ctx(PM), {
				userId: BOB,
				taskId: present(
					await db.query.task.findFirst({
						where: and(
							eq(task.scope, "site"),
							eq(task.systemKey, "paid_leave"),
						),
						columns: { id: true },
					}),
					"paid leave task",
				).id,
				date: "2026-08-10",
				durationSeconds: 3600,
			}),
		).rejects.toThrow("cannot log absence");
		const scope = present(
			await accessService.peopleScope(
				ctx(PM),
				await accessService.resolve(ctx(PM)),
			),
			"scope",
		);
		expect(scope.has(BOB)).toBe(false);
		expect(scope.has(OLD)).toBe(true);
	});

	test("a PM re-assign keeps the flag of a live row", async () => {
		await projectsService.assignMember(ctx(OWNER), {
			projectId,
			userId: OLD,
			role: "member",
		});
		await projectsService.assignMember(ctx(PM), {
			projectId,
			userId: OLD,
			role: "team_lead",
		});
		expect(await flagOf(OLD)).toBe(true);
	});

	test("an Admin assignment gives the PM access to a member", async () => {
		await projectsService.assignMember(ctx(OWNER), {
			projectId,
			userId: BOB,
			role: "member",
		});
		expect(await flagOf(BOB)).toBe(true);
		expect(await absenceOf(PM, BOB)).toEqual([]);
	});

	test("a PM who revives a removed row loses the flag", async () => {
		await projectsService.removeMember(ctx(PM), { projectId, userId: BOB });
		await projectsService.assignMember(ctx(PM), {
			projectId,
			userId: BOB,
			role: "member",
		});
		expect(await flagOf(BOB)).toBe(false);
		await expect(absenceOf(PM, BOB)).rejects.toThrow("cannot see");
	});
});
