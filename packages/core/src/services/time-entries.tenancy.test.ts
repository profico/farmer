// Regression test for the cross-tenant IDOR fix in time-entries.service.ts:
// create/update used to insert input.projectId/taskId with no check that they
// belonged to ctx.organizationId, so a user in org A could attach a time
// entry to a project id they merely guessed from org B. assertProjectInOrg /
// assertTaskBelongsToProject (both exported below, test-only) are the guard;
// this exercises them against a real DB rather than mocking drizzle, since
// the bug was specifically about the WHERE clause reaching the database.
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { organization } from "../db/schema/auth";
import { project, task } from "../db/schema/domain";
import { assertProjectInOrg, assertTaskBelongsToProject } from "./time-entries.service";
import type { Ctx } from "./types";

const orgAId = `test-org-a-${crypto.randomUUID()}`;
const orgBId = `test-org-b-${crypto.randomUUID()}`;

const [orgA, orgB] = await db
	.insert(organization)
	.values([
		{ id: orgAId, name: "Tenancy Test Org A", slug: orgAId, createdAt: new Date() },
		{ id: orgBId, name: "Tenancy Test Org B", slug: orgBId, createdAt: new Date() },
	])
	.returning();
if (!orgA || !orgB) throw new Error("Failed to seed test organizations");

const [projectInA] = await db
	.insert(project)
	.values({ organizationId: orgA.id, name: "Org A Project" })
	.returning();
const [projectInB] = await db
	.insert(project)
	.values({ organizationId: orgB.id, name: "Org B Project" })
	.returning();
if (!projectInA || !projectInB) throw new Error("Failed to seed test projects");

const [taskInB] = await db
	.insert(task)
	.values({ organizationId: orgB.id, projectId: projectInB.id, name: "Org B Task" })
	.returning();
if (!taskInB) throw new Error("Failed to seed test task");

afterAll(async () => {
	await db.delete(organization).where(eq(organization.id, orgA.id));
	await db.delete(organization).where(eq(organization.id, orgB.id));
});

const ctxForOrgA: Ctx = { organizationId: orgA.id, userId: "test-user" };

describe("assertProjectInOrg", () => {
	test("throws when the project belongs to a different org (cross-tenant IDOR)", async () => {
		await expect(
			assertProjectInOrg(ctxForOrgA, projectInB.id),
		).rejects.toThrow("Project not found");
	});

	test("resolves when the project belongs to the caller's org", async () => {
		await expect(
			assertProjectInOrg(ctxForOrgA, projectInA.id),
		).resolves.toBeUndefined();
	});

	test("throws for a project id that does not exist at all", async () => {
		await expect(
			assertProjectInOrg(ctxForOrgA, crypto.randomUUID()),
		).rejects.toThrow("Project not found");
	});
});

describe("assertTaskBelongsToProject", () => {
	test("throws when the task's org does not match ctx, even if projectId matches", async () => {
		// A malicious caller in org A could pass org B's real (project, task)
		// pair together — the old check only verified task.projectId ===
		// projectId, with no org constraint, so this used to pass.
		await expect(
			assertTaskBelongsToProject(ctxForOrgA, taskInB.id, projectInB.id),
		).rejects.toThrow("Task does not belong to that project");
	});
});
