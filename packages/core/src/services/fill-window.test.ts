// What a READ is allowed to rewrite, and what counts as a working day.
//
// Two bugs share this file because they shared a function.
//
// `listRange` still writes — a fill block's duration is derived from the day, so
// it is recomputed against the rows just read. That part is deliberate. What was
// not deliberate is that it had no window: scrolling the Month view back, or
// calling the public `GET /api/v1/time-entries` with a caller-supplied range,
// rewrote and deleted fill blocks anywhere in a person's history, including
// months locked by `automationLockedThrough` and already invoiced. And because
// `targetSecondsFor` reads CURRENT working hours with no effective dating,
// shortening your working day retroactively resized every fill block you had
// ever had, the next time anyone opened that range.
//
// The second bug is that `targetSecondsFor` never asked about public holidays.
// The weekend case worked by accident — a Saturday is disabled in
// `memberWorkingHoursDay`, so its target is 0 — while a public holiday, living
// in a different table, was a full 8-hour working day to every engine that
// writes. One commit pushed on Epiphany produced a full "rest of day" block,
// against a monthly fund that `hourFundService.suggestForMonth` had already
// excluded that day from.

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
import { projectGithubRepo } from "../db/schema/github";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import {
	commitFillTombstone,
	integrationSettings,
	orgSettings,
} from "../db/schema/settings";
import { createTestDb, present, type TestDb } from "../test/harness";
import { holidaysService } from "./holidays.service";
import { integrationSettingsService } from "./integration-settings.service";
import { setCommitSourceForTests } from "./ports";
import { timeEntriesService } from "./time-entries.service";
import type { Ctx } from "./types";

const ORG_ID = "org-fillwin";
const USER_ID = "user-fillwin";

/** Fresh per call — `ctxAccess` and the holiday calendar both memoize on the
 *  object, and a stale memo is exactly what would mask these. */
const ctx = (): Ctx => ({ organizationId: ORG_ID, userId: USER_ID });

// 2026-01-06 (Epiphany) is a Croatian public holiday AND a Tuesday, so the
// weekday schedule alone would call it a full 8-hour day.
const HOLIDAY = "2026-01-06";
const DAY_AFTER_HOLIDAY = "2026-01-07";
// Comfortably outside any automation window from "now".
const LONG_CLOSED_DAY = "2024-03-05";

let harness: TestDb;
let devTaskId = "";
let projectId = "";
let repoId = "";

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Fill Window Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
		country: "HR",
	});
	await db.insert(user).values({
		id: USER_ID,
		name: "Tester",
		email: "fillwin@example.com",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(member).values({
		id: "member-fillwin",
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
		.values({ organizationId: ORG_ID, clientId: c?.id ?? "", name: "Farmer" })
		.returning();
	projectId = p?.id ?? "";
	await db.insert(projectMember).values({
		organizationId: ORG_ID,
		projectId,
		userId: USER_ID,
		role: "member",
		active: true,
	});

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
	await db
		.insert(projectTask)
		.values({ organizationId: ORG_ID, projectId, taskId: devTaskId });

	const [repo] = await db
		.insert(projectGithubRepo)
		.values({
			organizationId: ORG_ID,
			projectId,
			githubRepoId: 1,
			owner: "profico",
			name: "farmer",
			fullName: "profico/farmer",
		})
		.returning({ id: projectGithubRepo.id });
	repoId = repo?.id ?? "";

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
	setCommitSourceForTests(null);
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
	await db.delete(orgSettings);
	await db.delete(integrationSettings);
	await db.delete(commitFillTombstone);
	await db
		.update(memberWorkingHoursDay)
		.set({ endTime: "17:00" })
		.where(eq(memberWorkingHoursDay.organizationId, ORG_ID));
});

const entriesOn = (date: string) =>
	db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ORG_ID),
			eq(timeEntry.userId, USER_ID),
			eq(timeEntry.date, date),
		),
	});

const addFill = (date: string, durationSeconds: number) =>
	db.insert(timeEntry).values({
		organizationId: ORG_ID,
		userId: USER_ID,
		taskId: devTaskId,
		projectId: null,
		date,
		durationSeconds,
		description: "Rest of day",
		fillsDay: true,
	});

/** Shorten the person's working day to 6h, as the my-schedule screen would. */
const shortenWorkingDayTo6h = () =>
	db
		.update(memberWorkingHoursDay)
		.set({ endTime: "15:00" })
		.where(eq(memberWorkingHoursDay.organizationId, ORG_ID));

describe("a read may only rewrite what an automation may rewrite", () => {
	test("reading a long-closed day leaves its fill block alone", async () => {
		await addFill(LONG_CLOSED_DAY, 8 * 3600);
		await shortenWorkingDayTo6h();

		await timeEntriesService.listRange(ctx(), {
			from: LONG_CLOSED_DAY,
			to: LONG_CLOSED_DAY,
		});

		const [row] = await entriesOn(LONG_CLOSED_DAY);
		expect(row?.durationSeconds).toBe(8 * 3600);
	});

	test("reading a long-closed day does not delete a fill block the day has outgrown", async () => {
		// The day is already fully accounted for by real work, so a recompute would
		// squeeze the fill to zero and drop the row. Correct inside the window,
		// destructive two years back.
		await db.insert(timeEntry).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: devTaskId,
			projectId,
			date: LONG_CLOSED_DAY,
			durationSeconds: 8 * 3600,
			description: "real work",
		});
		await addFill(LONG_CLOSED_DAY, 3600);

		await timeEntriesService.listRange(ctx(), {
			from: LONG_CLOSED_DAY,
			to: LONG_CLOSED_DAY,
		});

		expect(await entriesOn(LONG_CLOSED_DAY)).toHaveLength(2);
	});

	test("the returned rows match what is stored, so the screen does not lie", async () => {
		await addFill(LONG_CLOSED_DAY, 8 * 3600);
		await shortenWorkingDayTo6h();

		const listed = await timeEntriesService.listRange(ctx(), {
			from: LONG_CLOSED_DAY,
			to: LONG_CLOSED_DAY,
		});

		expect(listed).toHaveLength(1);
		expect(listed[0]?.durationSeconds).toBe(8 * 3600);
	});

	test("today's fill block IS still kept in sync — the window is a bound, not an off switch", async () => {
		const { dayKeyInTz } = await import("../lib/time");
		const today = dayKeyInTz(new Date(), "Europe/Zagreb");
		const target = await timeEntriesService.listRange(ctx(), {
			from: today,
			to: today,
		});
		expect(target).toHaveLength(0);

		await addFill(today, 8 * 3600);
		// A sibling entry lands by some path that did not recompute.
		await db.insert(timeEntry).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: devTaskId,
			projectId,
			date: today,
			durationSeconds: 2 * 3600,
			description: "meeting notes",
		});

		await timeEntriesService.listRange(ctx(), { from: today, to: today });

		const rows = await entriesOn(today);
		const fill = rows.find((r) => r.fillsDay);
		// Only meaningful on a day the schedule calls a working day.
		const isWorkingDay = ![0, 6].includes(
			new Date(`${today}T00:00:00Z`).getUTCDay(),
		);
		if (isWorkingDay) {
			expect(fill?.durationSeconds).toBe(6 * 3600);
		}
	});

	test("automationLockedThrough covering today closes the window entirely", async () => {
		const { dayKeyInTz, addDaysToKey } = await import("../lib/time");
		const today = dayKeyInTz(new Date(), "Europe/Zagreb");
		await db.insert(orgSettings).values({
			organizationId: ORG_ID,
			automationLockedThrough: addDaysToKey(today, 1),
		});

		await addFill(today, 8 * 3600);
		await db.insert(timeEntry).values({
			organizationId: ORG_ID,
			userId: USER_ID,
			taskId: devTaskId,
			projectId,
			date: today,
			durationSeconds: 2 * 3600,
			description: "meeting notes",
		});

		await timeEntriesService.listRange(ctx(), { from: today, to: today });

		const fill = (await entriesOn(today)).find((r) => r.fillsDay);
		expect(fill?.durationSeconds).toBe(8 * 3600);
	});

	test("a human editing their own old entry still recomputes that day", async () => {
		// The lock governs automation, not people: entries stay editable in closed
		// months on purpose, and a deliberate edit should leave the day coherent.
		await addFill(LONG_CLOSED_DAY, 8 * 3600);
		await timeEntriesService.create(ctx(), {
			taskId: devTaskId,
			projectId,
			description: "a correction, entered by hand",
			date: LONG_CLOSED_DAY,
			durationSeconds: 3 * 3600,
			overtime: false,
			fillsDay: false,
		});

		const fill = (await entriesOn(LONG_CLOSED_DAY)).find((r) => r.fillsDay);
		expect(fill?.durationSeconds).toBe(5 * 3600);
	});
});

describe("a public holiday is a non-working day", () => {
	test("the org calendar recognises the day at all", async () => {
		const holidays = await holidaysService.holidaySetForRange(
			ctx(),
			HOLIDAY,
			HOLIDAY,
		);
		expect(holidays.has(HOLIDAY)).toBe(true);
	});

	test("a commit pushed on a holiday files no rest-of-day block", async () => {
		await integrationSettingsService.update(ctx(), {
			githubSyncCommitsAsWorkTime: true,
		});
		await db
			.update(integrationSettings)
			.set({
				githubSyncCommitsAsWorkTimeSince: new Date("2026-01-01T00:00:00.000Z"),
			})
			.where(eq(integrationSettings.organizationId, ORG_ID));

		setCommitSourceForTests({
			listUserCommitsForDay: async () => [],
			listUserCommitsByDay: async (
				_c: Ctx,
				range: { from: string; to: string },
			) =>
				HOLIDAY >= range.from && HOLIDAY <= range.to
					? [
							{
								dayKey: HOLIDAY,
								commits: [
									{
										projectGithubRepoId: repoId,
										projectId,
										sha: "sha-holiday",
										message: "quick hotfix",
										authorLogin: "tester",
										committedAt: new Date(`${HOLIDAY}T21:00:00.000Z`),
										url: "https://example.com/c",
									},
								],
							},
						]
					: [],
		});

		const result = await timeEntriesService.runAutomationsForUser(ctx(), {
			now: new Date(`${DAY_AFTER_HOLIDAY}T12:00:00.000Z`),
		});
		expect(result.failed).toEqual([]);

		// No block. The day is not a working day, so there is no "rest" of it to
		// claim — exactly what already happened on a Saturday.
		expect(await entriesOn(HOLIDAY)).toHaveLength(0);
	});

	test("a fill block on a holiday is not resized up to a full day on read", async () => {
		await addFill(HOLIDAY, 2 * 3600);
		const { dayKeyInTz } = await import("../lib/time");
		const today = dayKeyInTz(new Date(), "Europe/Zagreb");
		// Force the day into the writable window so the read genuinely tries.
		await db.insert(orgSettings).values({
			organizationId: ORG_ID,
			automationLockedThrough: null,
		});
		await timeEntriesService.listRange(ctx(), { from: HOLIDAY, to: today });

		const rows = await entriesOn(HOLIDAY);
		// Either untouched (outside the window, the normal case) or dropped to zero
		// and removed (inside it) — but never grown to 8 hours.
		for (const row of rows) {
			expect(row.durationSeconds).toBeLessThanOrEqual(2 * 3600);
		}
	});

	test("assemble-my-day proposes nothing on a holiday", async () => {
		const { dayAssemblyService } = await import("./day-assembly.service");
		const assembly = await dayAssemblyService.suggest(ctx(), { date: HOLIDAY });
		expect(assembly.targetSeconds).toBe(0);
		expect(assembly.suggestions).toEqual([]);
	});

	test("a holiday the org has opted out of is an ordinary working day again", async () => {
		const holidays = await holidaysService.holidaySetForRange(
			ctx(),
			HOLIDAY,
			HOLIDAY,
		);
		const name = holidays.get(HOLIDAY);
		expect(name).toBeString();

		const disableCtx = ctx();
		await holidaysService.setHolidayDisabled(disableCtx, {
			name: present(name, "the holiday name"),
			disabled: true,
		});

		const { dayAssemblyService } = await import("./day-assembly.service");
		const assembly = await dayAssemblyService.suggest(ctx(), { date: HOLIDAY });
		expect(assembly.targetSeconds).toBe(8 * 3600);

		// Leave the calendar as we found it for the other tests in this file.
		await holidaysService.setHolidayDisabled(ctx(), {
			name: present(name, "the holiday name"),
			disabled: false,
		});
	});
});
