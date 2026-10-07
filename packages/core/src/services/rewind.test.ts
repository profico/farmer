// The Rewind reads one person's year. What is pinned here is what it must never
// get wrong: whose time it counts, which days it counts, and when it answers.
// The clock is pinned to Wednesday 10 December 2025, in a UTC org.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { client, project, task, timeEntry } from "../db/schema/domain";
import {
	timeEntryGithubCommit,
	timeEntryGithubPrActivity,
} from "../db/schema/github";
import { createTestDb, present, type TestDb } from "../test/harness";
import { rewindService } from "./rewind.service";
import type { Ctx } from "./types";

const H = 3600;
const ORG = "rw-org";
const ME = "u-rw-me";
const OTHER = "u-rw-other";
const BUSY = "u-rw-busy";
const NOW = new Date("2025-12-10T12:00:00Z");

const ctx: Ctx = { organizationId: ORG, userId: ME };
const busyCtx: Ctx = { organizationId: ORG, userId: BUSY };

let harness: TestDb;
let devTaskId: string;
let meetingTaskId: string;
let vacationTaskId: string;
let alphaId: string;
let betaId: string;

const log = async (
	userId: string,
	date: string,
	taskId: string,
	hours: number,
	projectId: string | null,
	description = "",
) => {
	await db.insert(timeEntry).values({
		organizationId: ORG,
		userId,
		date,
		taskId,
		projectId,
		description,
		durationSeconds: hours * H,
	});
};

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG,
		name: "Rewind Org",
		slug: "rw-org",
		timezone: "UTC",
		country: "US",
		createdAt: new Date(),
	});
	await db.insert(user).values(
		[ME, OTHER, BUSY].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(member).values(
		[ME, OTHER, BUSY].map((id) => ({
			id: `m-${id}`,
			organizationId: ORG,
			userId: id,
			role: "member",
			createdAt: new Date(),
		})),
	);

	const [acme, globex] = await db
		.insert(client)
		.values([
			{ organizationId: ORG, name: "Acme" },
			{ organizationId: ORG, name: "Globex" },
		])
		.returning();
	const [alpha, beta] = await db
		.insert(project)
		.values([
			{
				organizationId: ORG,
				clientId: present(acme, "Acme").id,
				name: "Alpha",
			},
			{
				organizationId: ORG,
				clientId: present(globex, "Globex").id,
				name: "Beta",
			},
		])
		.returning();
	alphaId = present(alpha, "Alpha").id;
	betaId = present(beta, "Beta").id;

	const [dev, vacation] = await db
		.insert(task)
		.values([
			{
				scope: "organization" as const,
				organizationId: ORG,
				name: "Development",
				group: "engineering" as const,
				systemKey: "development" as const,
			},
			{
				scope: "site" as const,
				name: "Vacation",
				group: "time_off" as const,
				isAbsence: true,
				systemKey: "vacation" as const,
			},
		])
		.returning();
	devTaskId = present(dev, "Development").id;
	vacationTaskId = present(vacation, "Vacation").id;
	// Seeded by the migrations.
	const meeting = await db.query.task.findFirst({
		where: eq(task.systemKey, "meeting"),
	});
	meetingTaskId = present(meeting, "Meeting").id;

	// Mon 1 to Tue 9 December: 8h a working day, the Monday on Beta.
	await log(ME, "2025-12-01", devTaskId, 8, betaId, "Checkout redesign");
	for (const day of ["02", "03", "04", "05", "08", "09"]) {
		await log(ME, `2025-12-${day}`, devTaskId, 6, alphaId, "Checkout fixes");
		await log(ME, `2025-12-${day}`, meetingTaskId, 2, null, "Standup");
	}
	// Saturday work, overtime.
	await db.insert(timeEntry).values({
		organizationId: ORG,
		userId: ME,
		date: "2025-12-06",
		taskId: devTaskId,
		projectId: alphaId,
		durationSeconds: 3 * H,
		overtime: true,
	});
	// A row on a day nobody has lived yet, and a holiday booked ahead.
	await log(ME, "2025-12-15", devTaskId, 8, alphaId);
	for (const day of ["22", "23", "24", "26", "29", "30", "31"]) {
		await log(ME, `2025-12-${day}`, vacationTaskId, 8, null);
	}
	// The year before, and somebody else's year.
	await log(ME, "2024-06-03", devTaskId, 5, alphaId);
	await log(OTHER, "2025-12-02", devTaskId, 8, alphaId);

	// BUSY's year: a tie for the busiest day, a Sunday, review time, learning
	// time, and GitHub evidence.
	const [review, learning] = await db
		.insert(task)
		.values([
			{
				scope: "organization" as const,
				organizationId: ORG,
				name: "Code Review",
				group: "engineering" as const,
				systemKey: "code_review" as const,
			},
			{
				scope: "organization" as const,
				organizationId: ORG,
				name: "Reading",
				group: "learning" as const,
			},
		])
		.returning();
	const reviewId = present(review, "Code Review").id;
	const learningId = present(learning, "Reading").id;
	// Tuesday and Wednesday tie at 5h; the earlier date must win.
	await log(BUSY, "2025-12-09", reviewId, 5, alphaId);
	await log(BUSY, "2025-12-03", devTaskId, 5, alphaId);
	await log(BUSY, "2025-12-04", devTaskId, 2, alphaId);
	await log(BUSY, "2025-12-07", learningId, 1, alphaId);
	const entries = await db
		.select({ id: timeEntry.id, date: timeEntry.date })
		.from(timeEntry)
		.where(eq(timeEntry.userId, BUSY));
	const entryOn = (date: string) =>
		present(
			entries.find((e) => e.date === date),
			date,
		).id;
	const commit = (timeEntryId: string, sha: string) => ({
		timeEntryId,
		sha,
		message: sha,
		committedAt: new Date(),
		url: `https://example.com/${sha}`,
	});
	// The same sha on two entries counts once.
	await db
		.insert(timeEntryGithubCommit)
		.values([
			commit(entryOn("2025-12-03"), "aaa"),
			commit(entryOn("2025-12-04"), "aaa"),
			commit(entryOn("2025-12-04"), "bbb"),
		]);
	const activity = (
		timeEntryId: string,
		kind: "opened" | "merged" | "reviewed",
		eventId: string,
	) => ({
		timeEntryId,
		kind,
		eventId,
		number: 1,
		title: "PR",
		pullRequestUrl: "https://example.com/pr/1",
		url: "https://example.com/pr/1",
		occurredAt: new Date(),
	});
	await db
		.insert(timeEntryGithubPrActivity)
		.values([
			activity(entryOn("2025-12-03"), "opened", "e1"),
			activity(entryOn("2025-12-04"), "opened", "e2"),
			activity(entryOn("2025-12-04"), "merged", "e3"),
			activity(entryOn("2025-12-09"), "reviewed", "e4"),
			activity(entryOn("2025-12-09"), "reviewed", "e5"),
			activity(entryOn("2025-12-09"), "reviewed", "e6"),
		]);
});

afterAll(async () => {
	await harness.close();
});

describe("rewindService.mine", () => {
	test("refuses a year that has not opened yet", async () => {
		const november = new Date("2025-11-20T12:00:00Z");
		await expect(
			rewindService.mine(ctx, { year: 2025 }, { now: november }),
		).rejects.toThrow("Your 2025 Rewind opens on 1 December.");
	});

	test("counts only the caller's own work, through today", async () => {
		const rewind = await rewindService.mine(ctx, { year: 2025 }, { now: NOW });
		// 8 + 6 × 8 + 3; neither the 15th nor the other person's day.
		expect(rewind.workedSeconds).toBe(59 * H);
		expect(rewind.asOf).toBe("2025-12-10");
		expect(rewind.complete).toBe(false);
		expect(rewind.daysWorked).toBe(8);
		expect(rewind.weekendDaysWorked).toBe(1);
		expect(rewind.overtimeSeconds).toBe(3 * H);
		expect(rewind.meetingSeconds).toBe(12 * H);
		expect(rewind.previousYearWorkedSeconds).toBe(5 * H);
	});

	test("names projects by time and counts their clients", async () => {
		const rewind = await rewindService.mine(ctx, { year: 2025 }, { now: NOW });
		expect(rewind.projects.map((p) => [p.name, p.seconds / H])).toEqual([
			["Alpha", 39],
			["Beta", 8],
		]);
		expect(rewind.clientCount).toBe(2);
		expect(rewind.words[0]).toEqual({ word: "checkout", count: 7 });
	});

	test("projects December around the time off already booked", async () => {
		const rewind = await rewindService.mine(ctx, { year: 2025 }, { now: NOW });
		expect(rewind.timeOff.vacationDays).toBe(7);
		expect(rewind.timeOff.aheadDays).toBe(7);
		const december = present(rewind.months[11], "December");
		expect(december.seconds).toBe(59 * H);
		// The pace is 59h over 7 working days. Christmas is a US holiday, and
		// the booked days are away, which leaves the 10th to the 19th: 8 days.
		const pace = (59 * H) / 7;
		expect(december.projectedSeconds).toBe(Math.round(pace * 8));
		expect(rewind.projectedWorkedSeconds).toBe(
			59 * H + december.projectedSeconds,
		);
	});

	test("a year that is over carries no projection", async () => {
		const later = new Date("2026-03-01T12:00:00Z");
		const rewind = await rewindService.mine(
			ctx,
			{ year: 2025 },
			{ now: later },
		);
		expect(rewind.complete).toBe(true);
		expect(rewind.asOf).toBe("2025-12-31");
		expect(rewind.projectedWorkedSeconds).toBeNull();
		// The 15th is lived now.
		expect(rewind.workedSeconds).toBe(67 * H);
		expect(rewind.timeOff.aheadDays).toBe(0);
	});

	test("breaks down weekdays, groups and review time", async () => {
		const rewind = await rewindService.mine(
			busyCtx,
			{ year: 2025 },
			{ now: NOW },
		);
		// Sunday 1h, Tuesday 5h, Wednesday 5h, Thursday 2h.
		expect(rewind.weekdays.map((s) => s / H)).toEqual([1, 0, 5, 5, 2, 0, 0]);
		expect(rewind.groups.map((g) => [g.group, g.seconds / H])).toEqual([
			["engineering", 12],
			["learning", 1],
		]);
		expect(rewind.codeReviewSeconds).toBe(5 * H);
		expect(rewind.meetingSeconds).toBe(0);
		expect(rewind.weekendDaysWorked).toBe(1);
	});

	test("names the earlier day when two days tie for busiest", async () => {
		const rewind = await rewindService.mine(
			busyCtx,
			{ year: 2025 },
			{ now: NOW },
		);
		expect(rewind.busiestDay).toEqual({ date: "2025-12-03", seconds: 5 * H });
	});

	test("counts distinct commits and pull request events", async () => {
		const rewind = await rewindService.mine(
			busyCtx,
			{ year: 2025 },
			{ now: NOW },
		);
		expect(rewind.commits).toBe(2);
		expect(rewind.pullRequests).toEqual({ opened: 2, merged: 1, reviewed: 3 });
	});
});
