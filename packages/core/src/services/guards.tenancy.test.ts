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
//
// Runs against an ephemeral PGLite instance (src/test/harness) — real Postgres,
// real migrations, but its own database. It previously wrote into whatever
// DATABASE_URL pointed at, seeded at module top level outside any hook, and
// suffixed site-scoped task names with a UUID to dodge task_site_name_uidx; a
// crashed run leaked those rows into a developer's dev database.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db } from "../db";
import { organization } from "../db/schema/auth";
import { client, project, task } from "../db/schema/domain";
import { createTestDb, type TestDb } from "../test/harness";
import { assertProjectInOrg, assertTaskAvailable } from "./guards";
import type { Ctx } from "./types";

let harness: TestDb;

let orgAId: string;

let orgBId: string;

let projectInAId: string;

let projectInBId: string;

let taskInAId: string;

let taskInBId: string;

let absenceTaskId: string;

let universalTaskId: string;

let ctxForOrgA: Ctx;

beforeAll(async () => {
	harness = await createTestDb();

	const [orgA, orgB] = await db
		.insert(organization)
		.values([
			{
				id: "org-a",
				name: "Tenancy Test Org A",
				slug: "org-a",
				createdAt: new Date(),
			},
			{
				id: "org-b",
				name: "Tenancy Test Org B",
				slug: "org-b",
				createdAt: new Date(),
			},
		])
		.returning();

	if (!orgA || !orgB) throw new Error("Failed to seed test organizations");
	orgAId = orgA.id;
	orgBId = orgB.id;

	// Every project needs a client, so each org gets one.
	const [clientInA, clientInB] = await db
		.insert(client)
		.values([
			{ organizationId: orgAId, name: "Client A" },
			{ organizationId: orgBId, name: "Client B" },
		])
		.returning();

	if (!clientInA || !clientInB) throw new Error("Failed to seed test clients");

	const [projectInA, projectInB] = await db
		.insert(project)
		.values([
			{ organizationId: orgAId, clientId: clientInA.id, name: "Org A Project" },
			{ organizationId: orgBId, clientId: clientInB.id, name: "Org B Project" },
		])
		.returning();

	if (!projectInA || !projectInB)
		throw new Error("Failed to seed test projects");
	projectInAId = projectInA.id;
	projectInBId = projectInB.id;

	// Tasks are org-scoped taxonomy, not per-project rows: every project of an org
	// offers every live task of that org, and nothing of any other org's.
	const [taskInA, taskInB] = await db
		.insert(task)
		.values([
			{ scope: "organization" as const, organizationId: orgAId, name: "Dev A" },
			{ scope: "organization" as const, organizationId: orgBId, name: "Dev B" },
		])
		.returning();

	if (!taskInA || !taskInB) throw new Error("Failed to seed test tasks");
	taskInAId = taskInA.id;
	taskInBId = taskInB.id;

	// A fresh database per run, so these no longer need UUID-suffixed names to
	// avoid colliding with a previous run's leftovers.
	const [absenceTask] = await db
		.insert(task)
		.values({ scope: "site" as const, name: "Test Vacation", isAbsence: true })
		.returning();

	if (!absenceTask) throw new Error("Failed to seed absence task");
	absenceTaskId = absenceTask.id;

	// A site-scoped non-absence built-in (Meeting/Break in production): available
	// to every org without any org owning it.
	const [universalTask] = await db
		.insert(task)
		.values({ scope: "site" as const, name: "Test Meeting", isAbsence: false })
		.returning();

	if (!universalTask) throw new Error("Failed to seed universal task");
	universalTaskId = universalTask.id;

	ctxForOrgA = { organizationId: orgAId, userId: "test-user" };
});

afterAll(async () => {
	// No row-by-row cleanup: the database goes away with the harness.
	await harness.close();
});

describe("assertProjectInOrg", () => {
	test("throws when the project belongs to a different org (cross-tenant IDOR)", async () => {
		await expect(assertProjectInOrg(ctxForOrgA, projectInBId)).rejects.toThrow(
			"Project not found",
		);
	});

	test("resolves when the project belongs to the caller's org", async () => {
		await expect(
			assertProjectInOrg(ctxForOrgA, projectInAId),
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
		// pair together — both rows genuinely exist and belong together, so only
		// the org constraint stops this.
		await expect(
			assertTaskAvailable(ctxForOrgA, taskInBId, projectInBId),
		).rejects.toThrow("Task not available");
	});

	test("resolves for any live task of the caller's own org", async () => {
		await expect(
			assertTaskAvailable(ctxForOrgA, taskInAId, projectInAId),
		).resolves.toMatchObject({ isAbsence: expect.any(Boolean) });
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
			assertTaskAvailable(ctxForOrgA, taskInAId, undefined),
		).resolves.toMatchObject({ isAbsence: expect.any(Boolean) });
	});

	// The cherry-pick bypass. Requiring an admin to add Meeting to every project
	// individually meant forgetting it on one made that project unable to accept
	// the calendar sync's own entries — a failure mode with no upside, since no
	// org opts out of meetings.
	test("resolves for a universal built-in the project never picked", async () => {
		await expect(
			assertTaskAvailable(ctxForOrgA, universalTaskId, projectInAId),
		).resolves.toMatchObject({ isAbsence: expect.any(Boolean) });
	});

	test("resolves for a site-wide absence task with no project", async () => {
		await expect(
			assertTaskAvailable(ctxForOrgA, absenceTaskId, undefined),
		).resolves.toMatchObject({ isAbsence: expect.any(Boolean) });
	});

	test("throws when an absence task is pinned to a project", async () => {
		await expect(
			assertTaskAvailable(ctxForOrgA, absenceTaskId, projectInAId),
		).rejects.toThrow("without a project");
	});

	test("throws for an archived task", async () => {
		const [archived] = await db
			.insert(task)
			.values({
				scope: "organization" as const,
				organizationId: orgAId,
				name: "Retired",
				archivedAt: new Date(),
			})
			.returning();

		if (!archived) throw new Error("Failed to seed archived task");
		await expect(
			assertTaskAvailable(ctxForOrgA, archived.id, projectInAId),
		).rejects.toThrow("Task not available");
	});
});
