// Regression test for the cross-tenant IDOR fix in the entry write path:
// create/update used to insert input.projectId/taskId with no check that they
// belonged to ctx.organizationId, so a user in org A could attach a time entry
// to a project id they merely guessed from org B. assertProjectInOrg /
// assertTaskAvailable (services/guards.ts) are the guard; this exercises them
// against a real DB rather than mocking drizzle, since the bug was specifically
// about the WHERE clause reaching the database.
//
// assertTaskAvailable also carries the absence invariant the database can't
// express (it needs a join), so that is covered here too.
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { organization } from "../db/schema/auth";
import { client, project, projectTask, task } from "../db/schema/domain";
import { assertProjectInOrg, assertTaskAvailable } from "./guards";
import type { Ctx } from "./types";

const orgAId = `test-org-a-${crypto.randomUUID()}`;
const orgBId = `test-org-b-${crypto.randomUUID()}`;

const [orgA, orgB] = await db
	.insert(organization)
	.values([
		{
			id: orgAId,
			name: "Tenancy Test Org A",
			slug: orgAId,
			createdAt: new Date(),
		},
		{
			id: orgBId,
			name: "Tenancy Test Org B",
			slug: orgBId,
			createdAt: new Date(),
		},
	])
	.returning();
if (!orgA || !orgB) throw new Error("Failed to seed test organizations");

// Every project needs a client now, so each org gets one.
const [clientInA, clientInB] = await db
	.insert(client)
	.values([
		{ organizationId: orgA.id, name: "Client A" },
		{ organizationId: orgB.id, name: "Client B" },
	])
	.returning();
if (!clientInA || !clientInB) throw new Error("Failed to seed test clients");

const [projectInA, projectInB] = await db
	.insert(project)
	.values([
		{ organizationId: orgA.id, clientId: clientInA.id, name: "Org A Project" },
		{ organizationId: orgB.id, clientId: clientInB.id, name: "Org B Project" },
	])
	.returning();
if (!projectInA || !projectInB) throw new Error("Failed to seed test projects");

// Tasks are org-scoped taxonomy now, not per-project rows; a project opts into
// one through projectTask. Org B picks its own task; org A leaves its task
// unpicked so the "not on this project" branch has something to fail on.
const [taskInA, taskInB] = await db
	.insert(task)
	.values([
		{ scope: "organization" as const, organizationId: orgA.id, name: "Dev A" },
		{ scope: "organization" as const, organizationId: orgB.id, name: "Dev B" },
	])
	.returning();
if (!taskInA || !taskInB) throw new Error("Failed to seed test tasks");

await db.insert(projectTask).values({
	organizationId: orgB.id,
	projectId: projectInB.id,
	taskId: taskInB.id,
});

const [absenceTask] = await db
	.insert(task)
	.values({
		scope: "site" as const,
		name: `Test Vacation ${crypto.randomUUID()}`,
		isAbsence: true,
	})
	.returning();
if (!absenceTask) throw new Error("Failed to seed absence task");

// A site-scoped non-absence built-in (Meeting/Break in production). Deliberately
// never linked through projectTask — being available without a link is the whole
// property under test.
const [universalTask] = await db
	.insert(task)
	.values({
		scope: "site" as const,
		name: `Test Meeting ${crypto.randomUUID()}`,
		isAbsence: false,
	})
	.returning();
if (!universalTask) throw new Error("Failed to seed universal task");

afterAll(async () => {
	await db.delete(organization).where(eq(organization.id, orgA.id));
	await db.delete(organization).where(eq(organization.id, orgB.id));
	await db.delete(task).where(eq(task.id, absenceTask.id));
	await db.delete(task).where(eq(task.id, universalTask.id));
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

describe("assertTaskAvailable", () => {
	test("throws when the task's org does not match ctx, even if the pair is internally consistent", async () => {
		// A malicious caller in org A could pass org B's real (project, task)
		// pair together — org B genuinely picked that task for that project, so
		// only the org constraint stops this.
		await expect(
			assertTaskAvailable(ctxForOrgA, taskInB.id, projectInB.id),
		).rejects.toThrow("Task not available");
	});

	test("throws when the project has not picked the task", async () => {
		await expect(
			assertTaskAvailable(ctxForOrgA, taskInA.id, projectInA.id),
		).rejects.toThrow("not available on this project");
	});

	test("resolves for a task the project has picked", async () => {
		await db
			.insert(projectTask)
			.values({
				organizationId: orgA.id,
				projectId: projectInA.id,
				taskId: taskInA.id,
			})
			.onConflictDoNothing();
		await expect(
			assertTaskAvailable(ctxForOrgA, taskInA.id, projectInA.id),
		).resolves.toBeUndefined();
	});

	// Was a rejection ("Pick a project"), now the legal UNFILED shape. The guard
	// used to forbid it while the calendar-sync, commit-fill and day-assembly
	// engines all wrote it straight to the database anyway — so the app produced
	// rows that neither `create` nor `update` would accept, which made a synced
	// meeting impossible to edit. Being unfiled is surfaced and chased elsewhere
	// (the time page's banner, the close sheet, and finalize refusing outright);
	// it is not the taxonomy guard's job to reject it.
	test("resolves for a worked task with no project yet (unfiled)", async () => {
		await expect(
			assertTaskAvailable(ctxForOrgA, taskInA.id, undefined),
		).resolves.toBeUndefined();
	});

	// The cherry-pick bypass. Requiring an admin to add Meeting to every project
	// individually meant forgetting it on one made that project unable to accept
	// the calendar sync's own entries — a failure mode with no upside, since no
	// org opts out of meetings.
	test("resolves for a universal built-in the project never picked", async () => {
		await expect(
			assertTaskAvailable(ctxForOrgA, universalTask.id, projectInA.id),
		).resolves.toBeUndefined();
	});

	test("resolves for a site-wide absence task with no project", async () => {
		await expect(
			assertTaskAvailable(ctxForOrgA, absenceTask.id, undefined),
		).resolves.toBeUndefined();
	});

	test("throws when an absence task is pinned to a project", async () => {
		await expect(
			assertTaskAvailable(ctxForOrgA, absenceTask.id, projectInA.id),
		).rejects.toThrow("without a project");
	});

	test("throws for an archived task", async () => {
		const [archived] = await db
			.insert(task)
			.values({
				scope: "organization" as const,
				organizationId: orgA.id,
				name: "Retired",
				archivedAt: new Date(),
			})
			.returning();
		if (!archived) throw new Error("Failed to seed archived task");
		await expect(
			assertTaskAvailable(ctxForOrgA, archived.id, projectInA.id),
		).rejects.toThrow("Task not available");
	});
});
