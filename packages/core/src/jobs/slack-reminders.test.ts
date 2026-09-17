// "Is today the last working day of the month?"
//
// The check used to ask only whether any LATER day in the month was a working
// day — which is true of every trailing weekend day too. A month ending on a
// Sunday therefore sent the month-end DM on the Friday, again on the Saturday
// and again on the Sunday. The `slack_reminder_log` claim is keyed on the DAY,
// so three different days meant three different claims and the idempotency
// guard never saw them as duplicates: everyone got the same nag three times,
// twice of it on a weekend.
//
// The audience for that DM is `complianceService.cohortForReminderJob` — asserted in
// services/compliance-schedule.test.ts, since the job itself reads the real
// clock and cannot be pointed at a month-end.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db } from "../db";
import { organization } from "../db/schema/auth";
import { disabledHoliday } from "../db/schema/schedule";
import type { Ctx } from "../services/types";
import { createTestDb, type TestDb } from "../test/harness";
import { isLastWorkingDayOfMonth } from "./slack-reminders";

const ORG_ID = "org-slack-reminders";

/** Fresh per call — the holiday calendar memoizes on the Ctx object. */
const ctx = (): Ctx => ({ organizationId: ORG_ID, userId: "" });

let harness: TestDb;

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values({
		id: ORG_ID,
		name: "Slack Reminders Org",
		slug: ORG_ID,
		createdAt: new Date(),
		timezone: "Europe/Zagreb",
		country: "HR",
	});
});

afterAll(async () => {
	await harness.close();
});

const isLast = (dayKey: string) => isLastWorkingDayOfMonth(ctx(), dayKey);

describe("last working day of the month", () => {
	// 2026-05-31 is a Sunday, so the month's last working day is Friday the 29th.
	test("a month ending on a Sunday fires on the Friday only", async () => {
		expect(await isLast("2026-05-29")).toBe(true); // Friday
		expect(await isLast("2026-05-30")).toBe(false); // Saturday
		expect(await isLast("2026-05-31")).toBe(false); // Sunday
	});

	test("and not on the Thursday before it", async () => {
		expect(await isLast("2026-05-28")).toBe(false);
	});

	// 2026-04-30 is a Thursday — the plain case.
	test("a month ending on a weekday fires on the last day", async () => {
		expect(await isLast("2026-04-30")).toBe(true);
		expect(await isLast("2026-04-29")).toBe(false);
	});

	// 2026-01-31 is a Saturday; the 30th is a Friday.
	test("a month ending on a Saturday fires on the Friday only", async () => {
		expect(await isLast("2026-01-30")).toBe(true);
		expect(await isLast("2026-01-31")).toBe(false);
	});

	test("a mid-month working day is never the last one", async () => {
		expect(await isLast("2026-04-15")).toBe(false);
	});

	// May 2025 ends Saturday the 31st, and Friday the 30th is Dan državnosti — a
	// Croatian public holiday. So the last working day is Thursday the 29th, and
	// the Friday is exactly the case the old check got wrong in the other
	// direction: nothing later in the month was a working day, so it said yes.
	test("a public holiday at the end of the month is not a working day", async () => {
		expect(await isLast("2025-05-29")).toBe(true); // Thursday
		expect(await isLast("2025-05-30")).toBe(false); // Friday, but a holiday
		expect(await isLast("2025-05-31")).toBe(false); // Saturday
	});

	test("opting out of that holiday moves the day forward to the Friday", async () => {
		await db.insert(disabledHoliday).values({
			organizationId: ORG_ID,
			name: "Dan državnosti",
		});

		try {
			expect(await isLast("2025-05-30")).toBe(true);
			expect(await isLast("2025-05-29")).toBe(false);
		} finally {
			await db.delete(disabledHoliday);
		}
	});
});
