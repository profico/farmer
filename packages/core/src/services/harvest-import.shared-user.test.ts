// Two organizations that import the same address each get their own
// placeholder person. Undo in one must leave the other's rows alone.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { task, timeEntry } from "../db/schema/domain";
import { importPendingPerson } from "../db/schema/import";
import type { HarvestStartInput } from "../schema/harvest-import";
import { createTestDb, present, type TestDb } from "../test/harness";
import { harvestImportService } from "./harvest-import.service";
import type { Ctx } from "./types";

const ORG = "hs-org";
const OTHER_ORG = "hs-other";
const ADMIN = "u-hs-admin";
const SHARED_EMAIL = "shared.person@example.com";

const admin: Ctx = { organizationId: ORG, userId: ADMIN };
const otherAdmin: Ctx = { organizationId: OTHER_ORG, userId: ADMIN };

let harness: TestDb;

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values(
		[ORG, OTHER_ORG].map((id) => ({
			id,
			name: id,
			slug: id,
			timezone: "UTC",
			createdAt: new Date(),
		})),
	);
	await db.insert(user).values({
		id: ADMIN,
		name: ADMIN,
		email: `${ADMIN}@example.com`,
		emailVerified: true,
	});
	await db.insert(member).values(
		[ORG, OTHER_ORG].map((organizationId) => ({
			id: `m-hs-admin-${organizationId}`,
			organizationId,
			userId: ADMIN,
			role: "admin",
			createdAt: new Date(),
		})),
	);
});

afterAll(async () => {
	await harness.close();
});

const input = (): HarvestStartInput => ({
	runId: crypto.randomUUID(),
	source: "harvest",
	cutoffDate: "2025-04-01",
	clients: [],
	tasks: [],
	projects: [],
	people: [
		{
			action: "create",
			sourceKey: "shared person",
			name: "Shared Person",
			email: SHARED_EMAIL,
			emailListed: true,
			emailConfirmed: true,
			role: "member",
			type: "employee_billable",
			startDate: "2024-01-01",
			archivedOn: null,
		},
	],
	projectMembers: [],
});

describe("undo of a run that made a placeholder", () => {
	test("keeps the placeholder another organization made for the address", async () => {
		const mine = await harvestImportService.start(admin, input());
		await harvestImportService.start(otherAdmin, input());
		const placeholders = await db
			.select()
			.from(importPendingPerson)
			.where(eq(importPendingPerson.email, SHARED_EMAIL));
		// One placeholder for each organization, never a shared row.
		expect(placeholders.map((p) => p.organizationId).sort()).toEqual(
			[ORG, OTHER_ORG].sort(),
		);
		const theirs = present(
			placeholders.find((p) => p.organizationId === OTHER_ORG),
			"the other placeholder",
		);
		const [otherTask] = await db
			.insert(task)
			.values({ scope: "organization", organizationId: OTHER_ORG, name: "Dev" })
			.returning();
		await db.insert(timeEntry).values({
			organizationId: OTHER_ORG,
			userId: theirs.userId,
			date: "2025-03-03",
			taskId: present(otherTask, "task").id,
			description: "other org hours",
			durationSeconds: 3600,
		});

		await harvestImportService.undo(admin, { runId: mine.runId });

		expect(
			await db.query.user.findFirst({ where: eq(user.id, theirs.userId) }),
		).toBeDefined();
		expect(
			await db
				.select()
				.from(timeEntry)
				.where(eq(timeEntry.organizationId, OTHER_ORG)),
		).toHaveLength(1);
		expect(
			await db
				.select()
				.from(importPendingPerson)
				.where(eq(importPendingPerson.organizationId, ORG)),
		).toHaveLength(0);
	});
});
