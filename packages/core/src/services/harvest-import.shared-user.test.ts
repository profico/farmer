// Undo must not delete a user row that another organization holds data for:
// the foreign keys from `member_profile`, `time_entry` and the rest to `user`
// cascade, so one organization's undo would delete another's rows.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { task, timeEntry } from "../db/schema/domain";
import { memberProfile } from "../db/schema/people";
import { createTestDb, present, type TestDb } from "../test/harness";
import { harvestImportService } from "./harvest-import.service";
import type { Ctx } from "./types";

const ORG = "hs-org";
const OTHER_ORG = "hs-other";
const ADMIN = "u-hs-admin";
const SHARED_EMAIL = "shared.person@example.com";

const admin: Ctx = { organizationId: ORG, userId: ADMIN };

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
	await db.insert(member).values({
		id: "m-hs-admin",
		organizationId: ORG,
		userId: ADMIN,
		role: "admin",
		createdAt: new Date(),
	});
});

afterAll(async () => {
	await harness.close();
});

describe("undo of a run that made a user another organization uses", () => {
	test("keeps the user row and the other organization's rows", async () => {
		const result = await harvestImportService.start(admin, {
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
		const shared = present(
			await db.query.user.findFirst({ where: eq(user.email, SHARED_EMAIL) }),
			"shared user",
		);

		// The other organization now holds the same person, as it would after
		// its own import found the existing user.
		await db.insert(member).values({
			id: "m-hs-shared-other",
			organizationId: OTHER_ORG,
			userId: shared.id,
			role: "member",
			createdAt: new Date(),
		});
		await db.insert(memberProfile).values({
			organizationId: OTHER_ORG,
			userId: shared.id,
			startDate: "2020-01-01",
		});
		const [otherTask] = await db
			.insert(task)
			.values({ scope: "organization", organizationId: OTHER_ORG, name: "Dev" })
			.returning();
		await db.insert(timeEntry).values({
			organizationId: OTHER_ORG,
			userId: shared.id,
			date: "2025-03-03",
			taskId: present(otherTask, "task").id,
			description: "other org hours",
			durationSeconds: 3600,
		});

		await harvestImportService.undo(admin, { runId: result.runId });

		expect(
			await db.query.user.findFirst({ where: eq(user.id, shared.id) }),
		).toBeDefined();
		const otherProfile = await db
			.select()
			.from(memberProfile)
			.where(
				and(
					eq(memberProfile.organizationId, OTHER_ORG),
					eq(memberProfile.userId, shared.id),
				),
			);
		expect(otherProfile).toHaveLength(1);
		const otherEntries = await db
			.select()
			.from(timeEntry)
			.where(eq(timeEntry.organizationId, OTHER_ORG));
		expect(otherEntries).toHaveLength(1);
		const mine = await db
			.select()
			.from(memberProfile)
			.where(
				and(
					eq(memberProfile.organizationId, ORG),
					eq(memberProfile.userId, shared.id),
				),
			);
		expect(mine).toHaveLength(0);
	});
});
