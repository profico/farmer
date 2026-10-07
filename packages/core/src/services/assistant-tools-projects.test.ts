// The assistant's project overview and assignable people tools.
//
// Both need rank on the project: the overview shows everyone's hours, and the
// assignable list is what a team page offers to somebody who manages the team.
// A Member is refused by the service and is not offered the tools. The result
// goes to the model provider, so the people list keeps no email, except where
// two people share a name.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { z } from "zod";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import { memberProfile } from "../db/schema/people";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { Access, AccessError } from "./access.service";
import { findTool, toolsFor } from "./assistant-tools";
import type { Ctx } from "./types";

const ORG = "org-ast-projects";
const OTHER_ORG = "org-ast-projects-other";
const PM = "user-ast-projects-pm";
const PLAIN = "user-ast-projects-plain";
const ADMIN = "user-ast-projects-admin";
const STRANGER = "user-ast-projects-stranger";

const ctxOf = (userId: string, organizationId = ORG): Ctx => ({
	organizationId,
	userId,
});
const tool = (name: string) => present(findTool(name), `tool ${name}`);

let harness: TestDb;
let alphaId = "";
let betaId = "";

const overview = z.object({
	project: z.string().nullable(),
	allTimeHours: z.number(),
	entries: z.number(),
	people: z.number(),
	firstEntry: z.string().nullable(),
	lastEntry: z.string().nullable(),
	overtimeHours: z.number(),
	thisMonthHours: z.number(),
});

const assignable = z.object({
	total: z.number(),
	truncated: z.boolean(),
	people: z.array(
		z.object({
			userId: z.string(),
			name: z.string(),
			email: z.string().nullable(),
		}),
	),
});

const seedPerson = async (
	id: string,
	name: string,
	organizationId: string,
	role: string,
) => {
	await db.insert(user).values({
		id,
		name,
		email: `${id}@example.com`,
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: `member-${id}`,
		organizationId,
		userId: id,
		role,
		createdAt: new Date(),
	});
};

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values([
		{ id: ORG, name: "Project tools", slug: ORG, createdAt: new Date() },
		{ id: OTHER_ORG, name: "Away", slug: OTHER_ORG, createdAt: new Date() },
	]);
	await seedPerson(PM, "Pia Manager", ORG, "member");
	await seedPerson(PLAIN, "Paul Plain", ORG, "member");
	await seedPerson(ADMIN, "Ada Admin", ORG, "owner");
	await seedPerson(STRANGER, "Sam Stranger", OTHER_ORG, "owner");
	// Two people with one name, and one who left.
	await seedPerson("user-ast-projects-twin-1", "Tina Twin", ORG, "member");
	await seedPerson("user-ast-projects-twin-2", "Tina Twin", ORG, "member");
	await seedPerson("user-ast-projects-gone", "Gone Person", ORG, "member");
	await db.insert(memberProfile).values({
		organizationId: ORG,
		userId: "user-ast-projects-gone",
		archivedAt: new Date(),
	});

	const acme = at(
		await db
			.insert(client)
			.values({ organizationId: ORG, name: "Acme" })
			.returning(),
		0,
	);
	const projects = await db
		.insert(project)
		.values([
			{ organizationId: ORG, clientId: acme.id, name: "Alpha" },
			{ organizationId: ORG, clientId: acme.id, name: "Beta" },
		])
		.returning();
	alphaId = at(projects, 0).id;
	betaId = at(projects, 1).id;
	await db.insert(projectMember).values([
		{ organizationId: ORG, projectId: alphaId, userId: PM, role: "pm" },
		{ organizationId: ORG, projectId: alphaId, userId: PLAIN },
		{ organizationId: ORG, projectId: betaId, userId: PLAIN },
	]);
	const dev = at(
		await db
			.insert(task)
			.values({
				scope: "organization" as const,
				organizationId: ORG,
				name: "Development",
				isAbsence: false,
			})
			.returning(),
		0,
	);
	const entry = (
		userId: string,
		projectId: string,
		date: string,
		seconds: number,
		overtime = false,
	) => ({
		organizationId: ORG,
		userId,
		projectId,
		taskId: dev.id,
		date,
		durationSeconds: seconds,
		description: "work",
		overtime,
	});
	await db
		.insert(timeEntry)
		.values([
			entry(PM, alphaId, "2026-01-05", 7200),
			entry(PLAIN, alphaId, "2026-01-06", 3600, true),
			entry(PLAIN, betaId, "2026-01-06", 36000),
		]);
});

afterAll(async () => {
	await harness.close();
});

describe("project_overview", () => {
	test("is a read, and a Member is not offered it", () => {
		expect(tool("project_overview").kind).toBe("read");
		const names = (isAdmin: boolean) =>
			toolsFor(new Access("u-1", "org-1", isAdmin, new Map())).map(
				(row) => row.name,
			);
		expect(names(false)).not.toContain("project_overview");
		expect(names(false)).not.toContain("list_assignable_people");
		expect(names(true)).toContain("project_overview");
	});

	test("a PM gets the figures of everyone on their project, and no other project", async () => {
		const answer = overview.parse(
			await tool("project_overview").run(ctxOf(PM), { projectId: alphaId }),
		);
		expect(answer).toMatchObject({
			project: "Alpha",
			allTimeHours: 3,
			entries: 2,
			people: 2,
			firstEntry: "2026-01-05",
			lastEntry: "2026-01-06",
			overtimeHours: 1,
		});
	});

	test("a PM is refused another project", async () => {
		await expect(
			tool("project_overview").run(ctxOf(PM), { projectId: betaId }),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("a Member who calls it anyway is refused", async () => {
		await expect(
			tool("project_overview").run(ctxOf(PLAIN), { projectId: alphaId }),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("another organization's project is not found", async () => {
		await expect(
			tool("project_overview").run(ctxOf(STRANGER, OTHER_ORG), {
				projectId: alphaId,
			}),
		).rejects.toThrow("Project not found");
	});
});

describe("list_assignable_people", () => {
	test("a PM sees the active people, with an email only where a name is shared", async () => {
		const answer = assignable.parse(
			await tool("list_assignable_people").run(ctxOf(PM), {
				projectId: alphaId,
			}),
		);
		const byId = new Map(
			answer.people.map((person) => [person.userId, person]),
		);
		// The person who left is not offered.
		expect(byId.has("user-ast-projects-gone")).toBe(false);
		// People who are not on the project yet are.
		expect(byId.has(ADMIN)).toBe(true);
		expect(byId.get(PLAIN)?.email).toBeNull();
		expect(byId.get("user-ast-projects-twin-1")?.email).toBe(
			"user-ast-projects-twin-1@example.com",
		);
		expect(byId.get("user-ast-projects-twin-2")?.email).toBe(
			"user-ast-projects-twin-2@example.com",
		);
		// Nobody of another organization.
		expect(byId.has(STRANGER)).toBe(false);
		expect(answer.truncated).toBe(false);
	});

	test("a PM is refused another project, and a Member is refused", async () => {
		await expect(
			tool("list_assignable_people").run(ctxOf(PM), { projectId: betaId }),
		).rejects.toBeInstanceOf(AccessError);
		await expect(
			tool("list_assignable_people").run(ctxOf(PLAIN), { projectId: alphaId }),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("cuts a long list and says so", async () => {
		const ids = Array.from(
			{ length: 110 },
			(_, index) => `user-ast-bulk-${index}`,
		);
		await db.insert(user).values(
			ids.map((id) => ({
				id,
				name: `Bulk ${id}`,
				email: `${id}@example.com`,
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			})),
		);
		await db.insert(member).values(
			ids.map((id) => ({
				id: `member-${id}`,
				organizationId: ORG,
				userId: id,
				role: "member",
				createdAt: new Date(),
			})),
		);
		const answer = assignable.parse(
			await tool("list_assignable_people").run(ctxOf(ADMIN), {
				projectId: alphaId,
			}),
		);
		expect(answer.people).toHaveLength(100);
		expect(answer.truncated).toBe(true);
		expect(answer.total).toBeGreaterThan(110);
	});
});
