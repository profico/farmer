// A project as `GET /api/v1/…/projects` and `…/projects/$id` send it. The
// service decides what each role may see; this file pins that the projection
// keeps the decision on the way out. `project-admin.test.ts` pins the shape. A plain member must not get the money fields or the
// project's real hours, and a Team Lead must not get the money fields.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
} from "../db/schema/domain";
import { AccessError } from "../services/access.service";
import { projectsService } from "../services/projects.service";
import type { Ctx } from "../services/types";
import { createTestDb, type TestDb } from "../test/harness";
import { toApiProjectDetail, toApiProjectOverview } from "./project-admin";

const ORG = "org-api-project";
const PM = "u-api-project-pm";
const LEAD = "u-api-project-lead";
const PLAIN = "u-api-project-plain";

const HOUR = 3600;

let harness: TestDb;
let projectId: string;

const ctx = (userId: string): Ctx => ({ organizationId: ORG, userId });

const detailFor = async (userId: string) =>
	toApiProjectDetail(await projectsService.get(ctx(userId), projectId));

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG,
		name: "API project",
		slug: ORG,
		createdAt: new Date(),
	});
	await db.insert(user).values(
		[PM, LEAD, PLAIN].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(member).values(
		[PM, LEAD, PLAIN].map((userId) => ({
			id: `m-${userId}`,
			organizationId: ORG,
			userId,
			role: "member",
			createdAt: new Date(),
		})),
	);

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG, name: "Acme" })
		.returning();
	if (!c) throw new Error("client");
	const [p] = await db
		.insert(project)
		.values({
			organizationId: ORG,
			clientId: c.id,
			name: "Apollo",
			budgetSeconds: 100 * HOUR,
			budgetAmount: "12000.00",
			hourlyPrice: "85.00",
		})
		.returning();
	if (!p) throw new Error("project");
	projectId = p.id;

	await db.insert(projectMember).values(
		[
			{ userId: PM, role: "pm" as const },
			{ userId: LEAD, role: "team_lead" as const },
			{ userId: PLAIN, role: "member" as const },
		].map((m) => ({ organizationId: ORG, projectId, ...m })),
	);

	const [work] = await db
		.insert(task)
		.values({
			organizationId: ORG,
			scope: "organization",
			name: "Development",
			systemKey: "development",
		})
		.returning();
	if (!work) throw new Error("task");
	const today = new Date().toISOString().slice(0, 10);
	await db.insert(timeEntry).values([
		{
			organizationId: ORG,
			userId: PLAIN,
			projectId,
			taskId: work.id,
			date: today,
			durationSeconds: 4 * HOUR,
			description: "mine",
		},
		{
			organizationId: ORG,
			userId: PM,
			projectId,
			taskId: work.id,
			date: today,
			durationSeconds: 2 * HOUR,
			description: "theirs",
		},
	]);
});

afterAll(async () => {
	await harness.close();
});

describe("what each role gets", () => {
	test("a plain member gets no money and only their own hours", async () => {
		const detail = await detailFor(PLAIN);
		expect(detail.role).toBe("member");
		expect(detail.stats.scope).toBe("own");
		expect(detail.stats.allTimeSeconds).toBe(4 * HOUR);
		expect(detail.stats.contributors).toEqual([]);
		expect([
			detail.budgetSeconds,
			detail.budgetAmount,
			detail.hourlyPrice,
		]).toEqual([null, null, null]);
	});

	test("a team lead gets the project's hours and no money", async () => {
		const detail = await detailFor(LEAD);
		expect(detail.stats.scope).toBe("project");
		expect(detail.stats.allTimeSeconds).toBe(6 * HOUR);
		expect([detail.budgetAmount, detail.hourlyPrice]).toEqual([null, null]);
	});

	test("a PM gets the money fields", async () => {
		const detail = await detailFor(PM);
		expect([
			detail.budgetSeconds,
			detail.budgetAmount,
			detail.hourlyPrice,
		]).toEqual([100 * HOUR, "12000.00", "85.00"]);
	});
});

describe("the overview", () => {
	test("a plain member is refused", async () => {
		await expect(
			projectsService.overview(ctx(PLAIN), projectId),
		).rejects.toBeInstanceOf(AccessError);
	});

	test("a team lead reads the whole project", async () => {
		const overview = toApiProjectOverview(
			await projectsService.overview(ctx(LEAD), projectId),
		);
		expect(overview.allTimeSeconds).toBe(6 * HOUR);
		expect(overview.peopleCount).toBe(2);
		expect(overview.entryCount).toBe(2);
	});
});
