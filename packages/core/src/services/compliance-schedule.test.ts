// Compliance judges each person against their own schedule, and addresses the
// cohort rather than the org.
//
// Two fixes share this file because the Slack month-end push consumed both.
//
// `noEntries` is a PER-PERSON judgement — "you have logged nothing for three
// working days" — and it was answering it from a hardcoded Mon-Fri. Somebody
// contracted Monday to Wednesday was reported as three working days behind every
// Thursday, appeared on the Admin dashboard, and got a Slack DM about it. The
// app has had per-member working hours all along; `jobs/log-reminders` reads
// them for exactly this question and gets it right.
//
// And `cohortForReminderJob` exists because the month-end DM selected every member of the
// org, so the two groups the compliance cohort exists to exclude got it anyway:
// archived people, who cannot act on it, and overhead people, whom the system
// deliberately never nags about timesheets.

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
import { timeEntry } from "../db/schema/domain";
import { memberProfile, memberTypeHistory } from "../db/schema/people";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import { orgSettings } from "../db/schema/settings";
import { dayKeyInTz } from "../lib/time";
import { createTestDb, type TestDb } from "../test/harness";
import { complianceService } from "./compliance.service";
import type { Ctx } from "./types";

const ORG_ID = "org-compliance";
const ADMIN_ID = "user-compliance-admin";
const FULL_TIMER = "user-full-timer";
const PART_TIMER = "user-part-timer";
const NO_SCHEDULE = "user-no-schedule";
const OVERHEAD = "user-overhead";
const ARCHIVED = "user-archived";

/** Fresh per call — the access and timezone memos hang off the object. */
const ctx = (): Ctx => ({ organizationId: ORG_ID, userId: ADMIN_ID });

const EVERYONE = [
	{ id: ADMIN_ID, name: "Admin" },
	{ id: FULL_TIMER, name: "Full Timer" },
	{ id: PART_TIMER, name: "Part Timer" },
	{ id: NO_SCHEDULE, name: "No Schedule" },
	{ id: OVERHEAD, name: "Overhead" },
	{ id: ARCHIVED, name: "Archived" },
];

let harness: TestDb;
/** Any seeded site task — these tests never care which. */
let anyTaskId = "";

/** `weekdays` is a set of JS day numbers (0 = Sunday). An empty set is a person
 *  with a schedule on file that says they work no days at all. */
const setSchedule = async (userId: string, weekdays: number[]) => {
	const enabled = new Set(weekdays);
	for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
		const on = enabled.has(dayOfWeek);
		await db.insert(memberWorkingHoursDay).values({
			organizationId: ORG_ID,
			userId,
			dayOfWeek,
			enabled: on,
			startTime: on ? "09:00" : null,
			endTime: on ? "17:00" : null,
		});
	}
};

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG_ID,
		name: "Compliance Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
		country: "HR",
	});
	for (const person of EVERYONE) {
		await db.insert(user).values({
			id: person.id,
			name: person.name,
			email: `${person.id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(member).values({
			id: `member-${person.id}`,
			organizationId: ORG_ID,
			userId: person.id,
			role: person.id === ADMIN_ID ? "owner" : "member",
			createdAt: new Date(),
		});
	}

	await setSchedule(ADMIN_ID, [1, 2, 3, 4, 5]);
	await setSchedule(FULL_TIMER, [1, 2, 3, 4, 5]);
	// The case the hardcoded Mon-Fri got wrong.
	await setSchedule(PART_TIMER, [1, 2, 3]);
	await setSchedule(NO_SCHEDULE, []);
	await setSchedule(OVERHEAD, [1, 2, 3, 4, 5]);
	await setSchedule(ARCHIVED, [1, 2, 3, 4, 5]);

	// Overhead: never nagged about timesheets, by design.
	await db.insert(memberTypeHistory).values({
		organizationId: ORG_ID,
		userId: OVERHEAD,
		type: "employee_overhead" as const,
		effectiveFrom: "2020-01-01",
	});
	// Archived: gone from every forward-looking surface, kept in every historical
	// one.
	await db.insert(memberProfile).values({
		organizationId: ORG_ID,
		userId: ARCHIVED,
		archivedAt: new Date("2026-01-01T00:00:00Z"),
	});

	const seeded = await db.query.task.findFirst({ columns: { id: true } });
	if (!seeded) throw new Error("migrations no longer seed any task");
	anyTaskId = seeded.id;
});

afterAll(async () => {
	await harness.close();
});

beforeEach(async () => {
	await db.delete(timeEntry);
	await db.delete(orgSettings);
});

const noEntriesBy = async () => {
	const rows = await complianceService.noEntries(ctx());
	return new Map(rows.map((r) => [r.userId, r]));
};

const thisMonth = () => {
	// The service reads the real clock, so the cohort month has to as well.
	const now = new Date();
	return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
};

describe("the compliance cohort", () => {
	test("excludes overhead people and archived people", async () => {
		const cohort = await complianceService.cohortForReminderJob(
			ctx(),
			thisMonth(),
		);
		const ids = cohort.map((c) => c.userId).sort();

		expect(ids).toEqual([ADMIN_ID, FULL_TIMER, PART_TIMER, NO_SCHEDULE].sort());
	});

	test("neither exclusion reaches the no-entries list either", async () => {
		const rows = await noEntriesBy();

		expect(rows.has(OVERHEAD)).toBe(false);
		expect(rows.has(ARCHIVED)).toBe(false);
	});
});

describe("noEntries against each person's own schedule", () => {
	test("a part-timer is behind by fewer working days than a full-timer", async () => {
		const rows = await noEntriesBy();

		const full = rows.get(FULL_TIMER);
		const part = rows.get(PART_TIMER);
		expect(full).toBeDefined();
		expect(part).toBeDefined();
		// Both have logged nothing, ever, over the same window. Under the old
		// hardcoded Mon-Fri these two numbers were identical — which is the bug:
		// the part-timer was charged for two days a week they do not work.
		expect(full?.workingDaysMissing).toBeGreaterThan(
			part?.workingDaysMissing ?? 0,
		);
	});

	test("a part-timer is charged roughly 3/5 of a full-timer's days", async () => {
		const rows = await noEntriesBy();
		const full = rows.get(FULL_TIMER)?.workingDaysMissing ?? 0;
		const part = rows.get(PART_TIMER)?.workingDaysMissing ?? 0;

		// Mon-Wed against Mon-Fri over the same span of weeks. Allowing a whole
		// day of slack at each end, because the window's edges land on whatever
		// weekday today happens to be.
		expect(part).toBeGreaterThanOrEqual(Math.floor((full * 3) / 5) - 1);
		expect(part).toBeLessThanOrEqual(Math.ceil((full * 3) / 5) + 1);
	});

	test("somebody whose schedule says they work no days is never behind", async () => {
		const rows = await noEntriesBy();

		// There were no days they were supposed to log. Mon-Fri said otherwise.
		expect(rows.has(NO_SCHEDULE)).toBe(false);
	});

	test("logging today clears everyone from the list", async () => {
		expect((await noEntriesBy()).size).toBeGreaterThan(0);

		// Today in the ORG's timezone — the same question the service asks.
		const today = dayKeyInTz(new Date(), "Europe/Zagreb");
		for (const userId of [ADMIN_ID, FULL_TIMER, PART_TIMER]) {
			await db.insert(timeEntry).values({
				organizationId: ORG_ID,
				userId,
				taskId: anyTaskId,
				date: today,
				durationSeconds: 3600,
				description: "Work",
			});
		}

		expect((await noEntriesBy()).size).toBe(0);
	});

	test("the threshold setting still applies per person", async () => {
		// A larger N means a longer lookback for everyone, so both numbers grow —
		// but the part-timer's stays below the full-timer's.
		await db
			.insert(orgSettings)
			.values({ organizationId: ORG_ID, complianceMissingDays: 5 })
			.onConflictDoUpdate({
				target: orgSettings.organizationId,
				set: { complianceMissingDays: 5 },
			});

		const rows = await noEntriesBy();
		expect(rows.get(PART_TIMER)?.workingDaysMissing ?? 0).toBeLessThan(
			rows.get(FULL_TIMER)?.workingDaysMissing ?? 0,
		);
	});
});

describe("the cohort survives a role change", () => {
	test("an admin is still judged on their own timesheet", async () => {
		const rows = await noEntriesBy();
		expect(rows.has(ADMIN_ID)).toBe(true);
	});

	test("restoring an archived person puts them back in the cohort", async () => {
		await db
			.update(memberProfile)
			.set({ archivedAt: null })
			.where(eq(memberProfile.userId, ARCHIVED));
		try {
			const cohort = await complianceService.cohortForReminderJob(
				ctx(),
				thisMonth(),
			);
			expect(cohort.map((c) => c.userId)).toContain(ARCHIVED);
		} finally {
			await db
				.update(memberProfile)
				.set({ archivedAt: new Date("2026-01-01T00:00:00Z") })
				.where(eq(memberProfile.userId, ARCHIVED));
		}
	});
});
