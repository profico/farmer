// The assembler must only propose what it could actually apply.
//
// `suggest` filtered candidate projects by existence but never by
// `access.canTrackOn`. `apply` routes through `timeEntriesService.create`, which
// does assert it — so the dialog offered a pre-ticked work entry and accepting
// it returned `{ created: 0, errors: ["You are not assigned to this project"] }`.
//
// Not an edge case: `listUserCommitsForDay` scans EVERY repo linked anywhere in
// the org, so any commit to a repo whose project you are not on lands here.

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
	task,
	timeEntry,
} from "../db/schema/domain";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import {
	commitFillTombstone,
	syncedMeetingTombstone,
} from "../db/schema/settings";
import { createTestDb, type TestDb } from "../test/harness";
import { dayAssemblyService } from "./day-assembly.service";
import { setCalendarSourceForTests, setCommitSourceForTests } from "./ports";
import type { Ctx } from "./types";

const ORG_ID = "org-assembly-access";

const USER_ID = "user-assembly-access";

const MONDAY = "2026-08-10";

/** Fresh per call — the access picture memoizes on the Ctx object. */
const ctx = (): Ctx => ({ organizationId: ORG_ID, userId: USER_ID });

let harness: TestDb;

/** Assigned to the user. */
let minePId = "";

/** Linked to a repo in the same org, but the user is not on it. */
let theirsPId = "";

const noCalendar = {
	listEventsForRange: async () => [],
	listEventsForDay: async () => [],
};

const commitsOn = (projectIds: string[]) => ({
	listUserCommitsByDay: async () => [],
	listUserCommitsForDay: async () =>
		projectIds.map((projectId, i) => ({
			projectId,
			projectGithubRepoId: `00000000-0000-0000-0000-00000000000${i + 1}`,
			repoFullName: `acme/repo-${i}`,
			sha: `sha${i}`,
			message: `fix: thing ${i}`,
			committedAt: new Date(`${MONDAY}T12:00:00.000Z`),
		})),
});

const siteTask = async (systemKey: "development" | "break" | "meeting") => {
	const existing = await db.query.task.findFirst({
		where: and(eq(task.scope, "site"), eq(task.systemKey, systemKey)),
		columns: { id: true },
	});

	if (existing) return existing.id;

	const [row] = await db
		.insert(task)
		.values({
			scope: "site" as const,
			name: systemKey,
			systemKey,
			isAbsence: false,
		})
		.returning({ id: task.id });

	return row?.id ?? "";
};

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Assembly Access Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "assembly-access@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	// A plain member. An admin satisfies every project check by override, which
	// is why the existing assembler fixture never caught this.
	await db.insert(member).values({
		id: "member-assembly-access",
		organizationId: ORG_ID,
		userId: USER_ID,
		role: "member",
		createdAt: new Date(),
	});

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG_ID, name: "Acme" })
		.returning();

	const [mine, theirs] = await db
		.insert(project)
		.values([
			{ organizationId: ORG_ID, clientId: c?.id ?? "", name: "Mine" },
			{ organizationId: ORG_ID, clientId: c?.id ?? "", name: "Theirs" },
		])
		.returning({ id: project.id });

	minePId = mine?.id ?? "";
	theirsPId = theirs?.id ?? "";

	// The work task exists for both projects — every task is on every project —
	// so only access can be what separates them.
	await siteTask("development");
	await siteTask("break");
	await siteTask("meeting");

	await db.insert(projectMember).values({
		organizationId: ORG_ID,
		projectId: minePId,
		userId: USER_ID,
		role: "member",
		active: true,
	});

	for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
		const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
		await db.insert(memberWorkingHoursDay).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			dayOfWeek,
			enabled: isWeekday,
			startTime: isWeekday ? "09:00" : null,
			endTime: isWeekday ? "17:00" : null,
		});
	}
});

afterAll(async () => {
	setCalendarSourceForTests(null);
	setCommitSourceForTests(null);
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
	await db.delete(syncedMeetingTombstone);
	await db.delete(commitFillTombstone);
	setCalendarSourceForTests(noCalendar);
});

const workSuggestions = async () => {
	const assembly = await dayAssemblyService.suggest(ctx(), { date: MONDAY });

	return assembly.suggestions.filter((s) => s.kind === "work");
};

describe("assemble my day and project access", () => {
	test("proposes work on a project the caller is assigned to", async () => {
		setCommitSourceForTests(commitsOn([minePId]));

		const work = await workSuggestions();
		expect(work).toHaveLength(1);
		expect(work[0]?.projectId).toBe(minePId);
	});

	test("does not propose work on a project the caller is not assigned to", async () => {
		setCommitSourceForTests(commitsOn([theirsPId]));

		expect(await workSuggestions()).toHaveLength(0);
	});

	test("with commits on both, only the assigned project is proposed", async () => {
		setCommitSourceForTests(commitsOn([minePId, theirsPId]));

		const work = await workSuggestions();
		expect(work).toHaveLength(1);
		expect(work[0]?.projectId).toBe(minePId);
	});

	// The property behind the fix: every suggestion the dialog shows must survive
	// `apply`, which runs the real write guards.
	test("everything proposed can actually be applied", async () => {
		setCommitSourceForTests(commitsOn([minePId, theirsPId]));

		const assembly = await dayAssemblyService.suggest(ctx(), { date: MONDAY });

		const result = await dayAssemblyService.apply(ctx(), {
			date: MONDAY,
			entries: assembly.suggestions.map((s) => ({
				taskId: s.taskId,
				projectId: s.projectId ?? undefined,
				description: s.description,
				durationSeconds: s.durationSeconds,
				fillsDay: s.fillsDay,
				meetingUrl: s.meetingUrl ?? undefined,
				calendarEventId: s.calendarEventId ?? undefined,
			})),
		});

		expect(result.errors).toEqual([]);
		expect(result.created).toBe(assembly.suggestions.length);
	});

	test("the day is still proposed in full — the fill absorbs the dropped work", async () => {
		setCommitSourceForTests(commitsOn([theirsPId]));

		const assembly = await dayAssemblyService.suggest(ctx(), { date: MONDAY });

		const total = assembly.suggestions.reduce(
			(sum, s) => sum + s.durationSeconds,
			0,
		);

		expect(total).toBe(assembly.targetSeconds);
	});

	test("losing the assignment after logging drops the project from future proposals", async () => {
		setCommitSourceForTests(commitsOn([minePId]));
		expect(await workSuggestions()).toHaveLength(1);

		await db
			.update(projectMember)
			.set({ active: false })
			.where(eq(projectMember.projectId, minePId));

		try {
			expect(await workSuggestions()).toHaveLength(0);
		} finally {
			await db
				.update(projectMember)
				.set({ active: true })
				.where(eq(projectMember.projectId, minePId));
		}
	});
});
