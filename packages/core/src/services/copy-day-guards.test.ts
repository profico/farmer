// Copying a day is a write, and has to answer the same questions a write does.
//
// `create` and `setWeekCell` both assert the project is in the org, that the
// caller may track on it, and that the task is still picked for it. `copyDay`
// inserted straight through `tx.insert(timeEntry)` and asked nothing. Tenancy
// was never at risk — the source rows are the caller's own, in their own org —
// but taxonomy and assignment were:
//
//   create the same entry by hand  ->  "You are not assigned to this project"
//   copyDay of the day holding it  ->  { copied: 1 }
//
// and the row it produced could then never be edited, because `update` does run
// the guards.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	projectTask,
	task,
	timeEntry,
} from "../db/schema/domain";
import { createTestDb, type TestDb } from "../test/harness";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-copy-guards";
const USER_ID = "user-copy-guards";
const MON = "2026-08-10";
const TUE = "2026-08-11";
const HOUR = 3600;

/** Fresh per call — `ctxAccess` memoizes the whole authorization picture on the
 *  Ctx object, and reusing one would answer from before the row was removed.
 *  This is the mistake that first made the bug look like it wasn't there. */
const ctx = (): Ctx => ({ organizationId: ORG_ID, userId: USER_ID });

let harness: TestDb;
let projectId = "";
let devTaskId = "";
let meetingTaskId = "";

const entriesOn = (date: string) =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, USER_ID),
			eq(timeEntry.date, date),
		),
	});

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Copy Guards Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "copy-guards@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	// A plain member, not an admin — `isAdmin` satisfies every project check by
	// override, so an owner fixture would pass with the guards removed.
	await db.insert(member).values({
		id: "member-copy-guards",
		organizationId: ORG_ID,
		userId: USER_ID,
		role: "member",
		createdAt: new Date(),
	});

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG_ID, name: "Acme" })
		.returning();
	const [p] = await db
		.insert(project)
		.values({ organizationId: ORG_ID, clientId: c?.id ?? "", name: "Farmer" })
		.returning({ id: project.id });
	projectId = p?.id ?? "";

	const [dev] = await db
		.insert(task)
		.values({
			scope: "organization" as const,
			organizationId: ORG_ID,
			name: "Development",
			systemKey: "development" as const,
			isAbsence: false,
		})
		.returning({ id: task.id });
	devTaskId = dev?.id ?? "";

	const seededMeeting = await db.query.task.findFirst({
		where: and(eq(task.scope, "site"), eq(task.systemKey, "meeting")),
		columns: { id: true },
	});
	if (!seededMeeting) throw new Error("migrations no longer seed Meeting");
	meetingTaskId = seededMeeting.id;
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
	await db.delete(projectMember);
	await db.delete(projectTask);
	// The assigned, picked baseline — each test takes something away from it.
	await db.insert(projectMember).values({
		organizationId: ORG_ID,
		projectId,
		userId: USER_ID,
		role: "member",
		active: true,
	});
	await db
		.insert(projectTask)
		.values({ organizationId: ORG_ID, projectId, taskId: devTaskId });
});

/** Write a source row directly, so the fixture can be torn down underneath it —
 *  which is the whole scenario: the entry was legal when it was logged. */
const seedEntry = (
	date: string,
	opts: {
		projectId?: string | null;
		taskId?: string;
		hours?: number;
		description?: string;
		fillsDay?: boolean;
	} = {},
) =>
	db.insert(timeEntry).values({
		organizationId: ORG_ID,
		userId: USER_ID,
		projectId: opts.projectId === undefined ? projectId : opts.projectId,
		taskId: opts.taskId ?? devTaskId,
		date,
		description: opts.description ?? "Work",
		durationSeconds: (opts.hours ?? 2) * HOUR,
		fillsDay: opts.fillsDay ?? false,
	});

describe("copyDay write guards", () => {
	test("copies an entry the caller is still allowed to log", async () => {
		await seedEntry(MON);

		const result = await timeEntriesService.copyDay(ctx(), {
			fromDate: MON,
			toDate: TUE,
		});

		expect(result).toEqual({ copied: 1, skipped: 0 });
		expect(await entriesOn(TUE)).toHaveLength(1);
	});

	test("does not copy onto a project the caller has been removed from", async () => {
		await seedEntry(MON);
		await db.delete(projectMember);

		// The comparison that defines the bug: by hand this is refused.
		await expect(
			timeEntriesService.create(ctx(), {
				date: TUE,
				projectId,
				taskId: devTaskId,
				description: "Work",
				durationSeconds: 2 * HOUR,
				overtime: false,
				fillsDay: false,
			}),
		).rejects.toThrow(/not assigned to this project/);

		const result = await timeEntriesService.copyDay(ctx(), {
			fromDate: MON,
			toDate: TUE,
		});

		expect(result).toEqual({ copied: 0, skipped: 1 });
		expect(await entriesOn(TUE)).toHaveLength(0);
	});

	test("does not copy a task the project has since un-picked", async () => {
		await seedEntry(MON);
		await db.delete(projectTask);

		const result = await timeEntriesService.copyDay(ctx(), {
			fromDate: MON,
			toDate: TUE,
		});

		expect(result).toEqual({ copied: 0, skipped: 1 });
		expect(await entriesOn(TUE)).toHaveLength(0);
	});

	test("copies what it may and skips what it may not, in the same day", async () => {
		await seedEntry(MON, { description: "On the project" });
		// Site-scoped, no project — nothing can un-assign this one.
		await seedEntry(MON, {
			projectId: null,
			taskId: meetingTaskId,
			description: "Standup",
			hours: 1,
		});
		await db.delete(projectMember);

		const result = await timeEntriesService.copyDay(ctx(), {
			fromDate: MON,
			toDate: TUE,
		});

		expect(result).toEqual({ copied: 1, skipped: 1 });
		const rows = await entriesOn(TUE);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.description).toBe("Standup");
	});

	test("a fill block on a project the caller has left is not copied either", async () => {
		await seedEntry(MON, { fillsDay: true, description: "Rest of day" });
		await db.delete(projectMember);

		const result = await timeEntriesService.copyDay(ctx(), {
			fromDate: MON,
			toDate: TUE,
		});

		expect(result.copied).toBe(0);
		expect(await entriesOn(TUE)).toHaveLength(0);
	});

	test("an admin is not blocked by an assignment they never had", async () => {
		await seedEntry(MON);
		await db.delete(projectMember);
		await db
			.update(member)
			.set({ role: "admin" })
			.where(eq(member.userId, USER_ID));

		try {
			const result = await timeEntriesService.copyDay(ctx(), {
				fromDate: MON,
				toDate: TUE,
			});
			expect(result).toEqual({ copied: 1, skipped: 0 });
		} finally {
			await db
				.update(member)
				.set({ role: "member" })
				.where(eq(member.userId, USER_ID));
		}
	});
});
