// An entry holding GitHub evidence stays on the day the evidence happened.
//
// The Log time dialog can move an entry to another day. Commits and pull
// request events attached to it are dated by GitHub, so a move would claim
// that work for a day it was not done on. `update` refuses the move; every
// other edit, and a move of an entry with nothing attached, still goes
// through.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { client, project, task, timeEntry } from "../db/schema/domain";
import {
	timeEntryGithubCommit,
	timeEntryGithubPrActivity,
} from "../db/schema/github";
import { createTestDb, present, type TestDb } from "../test/harness";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-move-day";
const USER_ID = "user-move-day";
const DAY = "2026-08-10";
const OTHER_DAY = "2026-08-11";
const HOUR = 3600;

const ctx = (): Ctx => ({ organizationId: ORG_ID, userId: USER_ID });

let harness: TestDb;
let projectId = "";
let devTaskId = "";

const addEntry = async () => {
	const [row] = await db
		.insert(timeEntry)
		.values({
			organizationId: ORG_ID,
			userId: USER_ID,
			projectId,
			taskId: devTaskId,
			date: DAY,
			description: "Work",
			durationSeconds: 2 * HOUR,
		})
		.returning();
	return present(row, "fixture entry");
};

const attachCommit = (timeEntryId: string) =>
	db.insert(timeEntryGithubCommit).values({
		timeEntryId,
		sha: "a1b2c3d4",
		message: "Fix the stepper",
		committedAt: new Date(`${DAY}T09:00:00Z`),
		url: "https://github.com/acme/farmer/commit/a1b2c3d4",
	});

const attachReview = (timeEntryId: string) =>
	db.insert(timeEntryGithubPrActivity).values({
		timeEntryId,
		eventId: "review-1",
		kind: "reviewed",
		reviewState: "approved",
		number: 50,
		title: "Step through days",
		pullRequestUrl: "https://github.com/acme/farmer/pull/50",
		url: "https://github.com/acme/farmer/pull/50#pullrequestreview-1",
		occurredAt: new Date(`${DAY}T10:00:00Z`),
	});

const updateTo = (
	entryId: string,
	change: { date: string; durationSeconds?: number },
) =>
	timeEntriesService.update(ctx(), {
		timeEntryId: entryId,
		projectId,
		taskId: devTaskId,
		date: change.date,
		description: "Work",
		durationSeconds: change.durationSeconds ?? 2 * HOUR,
		overtime: false,
		fillsDay: false,
	});

const dateOf = async (entryId: string) => {
	const row = await db.query.timeEntry.findFirst({
		where: eq(timeEntry.id, entryId),
		columns: { date: true },
	});
	return present(row, "entry").date;
};

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Move Day Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "move-day@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-move-day",
		organizationId: ORG_ID,
		userId: USER_ID,
		role: "owner",
		createdAt: new Date(),
	});

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG_ID, name: "Acme" })
		.returning();
	const [p] = await db
		.insert(project)
		.values({
			organizationId: ORG_ID,
			clientId: present(c, "client").id,
			name: "Farmer",
		})
		.returning();
	projectId = present(p, "project").id;

	const [t] = await db
		.insert(task)
		.values({
			scope: "organization" as const,
			organizationId: ORG_ID,
			name: "Development",
			isAbsence: false,
		})
		.returning();
	devTaskId = present(t, "development task").id;
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
});

describe("moving an entry to another day", () => {
	test("is refused while it holds a commit", async () => {
		const entry = await addEntry();
		await attachCommit(entry.id);

		await expect(updateTo(entry.id, { date: OTHER_DAY })).rejects.toThrow(
			/stays on the day they happened/,
		);
		expect(await dateOf(entry.id)).toBe(DAY);
	});

	test("is refused while it holds a pull request event", async () => {
		const entry = await addEntry();
		await attachReview(entry.id);

		await expect(updateTo(entry.id, { date: OTHER_DAY })).rejects.toThrow(
			/stays on the day they happened/,
		);
		expect(await dateOf(entry.id)).toBe(DAY);
	});

	test("goes through for an entry with nothing attached", async () => {
		const entry = await addEntry();

		await updateTo(entry.id, { date: OTHER_DAY });

		expect(await dateOf(entry.id)).toBe(OTHER_DAY);
	});

	test("does not stop an edit on the entry's own day", async () => {
		const entry = await addEntry();
		await attachCommit(entry.id);

		await updateTo(entry.id, { date: DAY, durationSeconds: 3 * HOUR });

		const row = await db.query.timeEntry.findFirst({
			where: eq(timeEntry.id, entry.id),
		});
		expect(present(row, "entry").durationSeconds).toBe(3 * HOUR);
	});
});
