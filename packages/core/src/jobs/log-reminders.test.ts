// The log reminder job, on two properties the reminder-settings suite
// (`reminders.test.ts`) does not pin:
//
//   1. A PERSON `notify` WOULD HOLD BACK NEVER REACHES `notify`. The job read
//      every member and let `notify` refuse the archived and the never signed
//      in, one person at a time, five gate queries each, on every tick of the
//      day. After a history import that is dozens of people. The job now drops
//      them with one batched `deliveryBlocks` read for the org.
//   2. NOTHING GOES OUT BETWEEN 20:00 AND 07:00 (docs/plans/reminder-settings.md
//      §3). The end-of-workday mode used the person's own end time with no
//      bound, so a late shift got its push at 22:00, and any tick after the send
//      time — 23:30 included — could send.
//
// April 2026, UTC, a US calendar: Tuesday the 14th is an ordinary working day.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { account, member, organization, user } from "../db/schema/auth";
import { notificationSettings } from "../db/schema/notifications";
import { memberProfile } from "../db/schema/people";
import { memberWorkingHoursDay } from "../db/schema/schedule";
import { reminderSettings } from "../db/schema/settings";
import { REMINDER_SETTINGS_DEFAULTS } from "../schema/reminder-settings";
import * as notifyModule from "../services/notify";
import {
	type NotifyAdapter,
	setNotifyAdaptersForTests,
} from "../services/notify";
import { sendTimeReached } from "../services/reminder-recipients";
import { reminderSettingsService } from "../services/reminder-settings.service";
import { createTestDb, type TestDb } from "../test/harness";
import { runLogRemindersOnce } from "./log-reminders";

const ORG = "org-log-rem";
/** Owner. Works the synthesized 09:00–17:00 and logs nothing. */
const ADMIN = "u-lr-admin";
/** Works 12:00–22:00 on Tuesdays and logs nothing. */
const LATE = "u-lr-late";
/** Left. Signed in once, logs nothing. */
const ARCHIVED = "u-lr-archived";
/** Imported: no `account` row, logs nothing. */
const NEVER = "u-lr-never";

const EVERYONE = [ADMIN, LATE, ARCHIVED, NEVER];
const TUESDAY = "2026-04-14";

let harness: TestDb;
let reached: string[] = [];

const recorder: NotifyAdapter = async (to) => {
	reached.push(to.userId);
	return true;
};

const logAt = (day: string, time: string) =>
	runLogRemindersOnce({ now: new Date(`${day}T${time}:00Z`) });

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values({
		id: ORG,
		name: "Log Reminders Org",
		slug: ORG,
		timezone: "UTC",
		country: "US",
		createdAt: new Date(),
	});
	await db.insert(user).values(
		EVERYONE.map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(member).values(
		EVERYONE.map((id) => ({
			id: `m-${id}`,
			organizationId: ORG,
			userId: id,
			role: id === ADMIN ? "owner" : "member",
			createdAt: new Date(),
		})),
	);
	await db.insert(account).values(
		EVERYONE.filter((id) => id !== NEVER).map((id) => ({
			id: `acc-${id}`,
			accountId: id,
			providerId: "credential",
			userId: id,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(memberProfile).values({
		organizationId: ORG,
		userId: ARCHIVED,
		archivedAt: new Date("2026-01-01T00:00:00Z"),
	});
	await db.insert(memberWorkingHoursDay).values({
		organizationId: ORG,
		userId: LATE,
		dayOfWeek: 2,
		enabled: true,
		startTime: "12:00",
		endTime: "22:00",
	});
});

afterAll(async () => {
	setNotifyAdaptersForTests();
	await harness.close();
});

beforeEach(async () => {
	reached = [];
	setNotifyAdaptersForTests({ push: recorder, slack: recorder });
	await db.delete(notificationSettings);
	await db.delete(reminderSettings);
});

describe("people notify would hold back", () => {
	test("are dropped before notify, and still get nothing", async () => {
		const spy = spyOn(notifyModule, "notify");
		try {
			const summary = await logAt(TUESDAY, "17:00");
			const asked = spy.mock.calls.map(([to]) => to.userId);
			// The job did send: ADMIN's workday is over and nothing is logged.
			expect(asked).toEqual([ADMIN]);
			expect(asked).not.toContain(ARCHIVED);
			expect(asked).not.toContain(NEVER);
			expect(reached).toEqual([ADMIN]);
			expect(summary).toMatchObject({ sent: 1, failed: 0 });
		} finally {
			spy.mockRestore();
		}
	});

	test("an imported person is asked about once the org includes them", async () => {
		await reminderSettingsService.update(
			{ organizationId: ORG, userId: ADMIN },
			{ includeNeverSignedIn: true },
		);
		await logAt(TUESDAY, "17:00");
		expect([...reached].sort()).toEqual([ADMIN, NEVER].sort());
	});
});

describe("an organization with a stored timezone that is not valid", () => {
	test("does not stop the run for the other organizations", async () => {
		const BAD = "org-log-rem-bad";
		await db.insert(organization).values({
			id: BAD,
			name: "Bad zone",
			slug: BAD,
			timezone: "Not/AZone",
			country: "US",
			createdAt: new Date(),
		});
		await db.insert(member).values({
			id: "m-bad",
			organizationId: BAD,
			userId: ADMIN,
			role: "member",
			createdAt: new Date(),
		});
		try {
			const summary = await logAt(TUESDAY, "17:00");
			expect(reached).toContain(ADMIN);
			expect(summary.sent).toBeGreaterThanOrEqual(1);
		} finally {
			await db.delete(member).where(eq(member.id, "m-bad"));
			await db.delete(organization).where(eq(organization.id, BAD));
		}
	});
});

describe("the quiet hours", () => {
	test("a workday that ends after 20:00 is reminded at 20:00", async () => {
		await logAt(TUESDAY, "19:45");
		expect(reached).toEqual([ADMIN]);
		reached = [];
		await logAt(TUESDAY, "20:00");
		expect(reached).toEqual([LATE]);
	});

	test("nothing goes out between 20:00 and 07:00, in either mode", async () => {
		// Due since 17:00 and never reminded — and still not at 22:00.
		await logAt(TUESDAY, "22:00");
		await logAt(TUESDAY, "06:45");
		expect(reached).toEqual([]);

		await reminderSettingsService.update(
			{ organizationId: ORG, userId: ADMIN },
			{ logMode: "fixed", logTime: "12:00" },
		);
		await logAt(TUESDAY, "21:00");
		expect(reached).toEqual([]);
	});

	test("the Slack kinds keep the same hours", () => {
		const settings = REMINDER_SETTINGS_DEFAULTS;
		expect(sendTimeReached(settings, "compliance-nudge", "09:00")).toBe(true);
		expect(sendTimeReached(settings, "compliance-nudge", "20:00")).toBe(true);
		expect(sendTimeReached(settings, "compliance-nudge", "20:15")).toBe(false);
		expect(sendTimeReached(settings, "admin-digest", "23:30")).toBe(false);
		expect(sendTimeReached(settings, "log-reminder", "06:45")).toBe(false);
	});
});
