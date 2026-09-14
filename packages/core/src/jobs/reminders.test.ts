// The reminder settings (docs/plans/reminder-settings.md §5), pinned end to end
// through the two jobs that send and the preview that shows.
//
// The property worth the most is the first block: with no settings row at all,
// every reminder goes to the people, on the days, at the times and with the
// words it did when all of this was constants — except that nobody archived and
// nobody who has never signed in gets one. An org that never opens the page
// must not notice the page exists.
//
// Everything runs against a pinned clock. April 2026, UTC, a US calendar with no
// public holiday in the month: Tuesday the 14th is a nudge and digest day, the
// 15th a Wednesday, the 17th a Friday, and Thursday the 30th the last working
// day of the month.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { db } from "../db";
import { account, member, organization, user } from "../db/schema/auth";
import { task, timeEntry } from "../db/schema/domain";
import { notificationSettings } from "../db/schema/notifications";
import { memberProfile, memberTypeHistory } from "../db/schema/people";
import {
	monthlyHourFund,
	orgSettings,
	reminderSettings,
} from "../db/schema/settings";
import {
	memberSlackIdentity,
	slackInstallation,
	slackReminderLog,
} from "../db/schema/slack";
import { datesBetween, formatDurationShort } from "../lib/time";
import {
	REMINDER_SETTINGS_DEFAULTS,
	type ReminderKind,
	type UpdateReminderSettingsInput,
	updateReminderSettingsInput,
} from "../schema/reminder-settings";
import { AccessError } from "../services/access.service";
import {
	type NotifyAdapter,
	type NotifyChannel,
	notify,
	setNotifyAdaptersForTests,
	wasDelivered,
} from "../services/notify";
import { orgSettingsService } from "../services/org-settings.service";
import { reminderSettingsService } from "../services/reminder-settings.service";
import type { Ctx } from "../services/types";
import { createTestDb, type TestDb } from "../test/harness";
import { runLogRemindersOnce } from "./log-reminders";
import {
	forgetSlackReminderRunsForTests,
	runSlackRemindersOnce,
} from "./slack-reminders";

const H = 3600;
const ORG = "org-reminders";

/** Owner. Logs a full day, every day: never nagged, always gets the digest. */
const ADMIN = "u-rem-admin";
/** Logs nothing: no entries, and at 0% of pace. */
const SILENT = "u-rem-silent";
/** Logs half a day, every day: recent entries, but at 50% of pace. */
const SLOW = "u-rem-slow";
/** Contractor with no expected-hours override: no entries, and no pace. */
const CONTRACTOR = "u-rem-contractor";
/** Logs nothing, and has no `account` row — an imported person. */
const NEVER = "u-rem-never";
/** An admin who left. Would get every reminder, the digest included. */
const ARCHIVED = "u-rem-archived";

const EVERYONE = [ADMIN, SILENT, SLOW, CONTRACTOR, NEVER, ARCHIVED];

const TUESDAY = "2026-04-14";
const WEDNESDAY = "2026-04-15";
const FRIDAY = "2026-04-17";
const DAY_BEFORE_MONTH_END = "2026-04-29";
const MONTH_END = "2026-04-30";

/** "HH:mm" on `day`, in the org's timezone (UTC). */
const instant = (day: string, time: string) => new Date(`${day}T${time}:00Z`);

const adminCtx = (): Ctx => ({ organizationId: ORG, userId: ADMIN });

type Sent = {
	channel: NotifyChannel;
	userId: string;
	kind: string;
	title: string | undefined;
	body: string;
	slack: string | undefined;
};

let harness: TestDb;
let sent: Sent[] = [];

const recorder =
	(channel: NotifyChannel): NotifyAdapter =>
	async (to, event) => {
		sent.push({
			channel,
			userId: to.userId,
			kind: event.kind,
			title: event.title,
			body: event.body,
			slack: event.slack,
		});
		return true;
	};

/** Who got `kind`, sorted — the shape every assertion compares. */
const reached = (kind: ReminderKind) =>
	[...new Set(sent.filter((s) => s.kind === kind).map((s) => s.userId))].sort();

const sentTo = (kind: ReminderKind, userId: string) =>
	sent.find((s) => s.kind === kind && s.userId === userId);

const bodyFor = (kind: ReminderKind, userId: string) =>
	sentTo(kind, userId)?.body;

const titleFor = (kind: ReminderKind, userId: string) =>
	sentTo(kind, userId)?.title;

const configure = (patch: UpdateReminderSettingsInput) =>
	reminderSettingsService.update(adminCtx(), patch);

const slackAt = (day: string, time: string) =>
	runSlackRemindersOnce({ now: instant(day, time) });

const logAt = (day: string, time: string) =>
	runLogRemindersOnce({ now: instant(day, time) });

const sorted = (ids: string[]) => [...ids].sort();

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG,
		name: "Reminders Org",
		slug: ORG,
		timezone: "UTC",
		country: "US",
		createdAt: new Date(),
	});
	await db.insert(user).values(
		EVERYONE.map((id) => ({
			id,
			name: id.replace("u-rem-", ""),
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
			role: id === ADMIN ? "owner" : id === ARCHIVED ? "admin" : "member",
			createdAt: new Date(),
		})),
	);
	// Everyone but NEVER has signed in.
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
	await db.insert(memberTypeHistory).values({
		organizationId: ORG,
		userId: CONTRACTOR,
		type: "contractor_hourly" as const,
		effectiveFrom: "2020-01-01",
	});
	await db.insert(memberProfile).values({
		organizationId: ORG,
		userId: ARCHIVED,
		archivedAt: new Date("2026-01-01T00:00:00Z"),
	});
	await db.insert(slackInstallation).values({
		organizationId: ORG,
		teamId: "T123",
		botToken: "xoxb-test",
	});
	// 22 working days × 8h. Nobody has a schedule row, so everyone works the
	// synthesized Mon–Fri 09:00–17:00.
	await db.insert(monthlyHourFund).values({
		organizationId: ORG,
		year: 2026,
		month: 4,
		fundSeconds: 176 * H,
	});

	const [dev] = await db
		.insert(task)
		.values({
			scope: "organization" as const,
			organizationId: ORG,
			name: "Development",
		})
		.returning();
	if (!dev) throw new Error("Failed to seed a task");
	const workingDays = datesBetween("2026-04-01", MONTH_END).filter((key) => {
		const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
		return weekday !== 0 && weekday !== 6;
	});
	await db.insert(timeEntry).values(
		workingDays.flatMap((date) => [
			{
				organizationId: ORG,
				userId: ADMIN,
				taskId: dev.id,
				date,
				durationSeconds: 8 * H,
				description: "Work",
			},
			{
				organizationId: ORG,
				userId: SLOW,
				taskId: dev.id,
				date,
				durationSeconds: 4 * H,
				description: "Work",
			},
		]),
	);
});

afterAll(async () => {
	setNotifyAdaptersForTests();
	await harness.close();
});

beforeEach(async () => {
	sent = [];
	setNotifyAdaptersForTests({
		push: recorder("push"),
		slack: recorder("slack"),
	});
	forgetSlackReminderRunsForTests();
	await db.delete(slackReminderLog);
	await db.delete(memberSlackIdentity);
	await db.delete(notificationSettings);
	await db.delete(reminderSettings);
	await db.delete(orgSettings);
});

describe("the defaults reproduce the jobs as they were", () => {
	test("the log reminder: after the workday, to everyone short of it", async () => {
		await logAt(TUESDAY, "16:45");
		expect(sent).toHaveLength(0);

		await logAt(TUESDAY, "17:00");
		expect(reached("log-reminder")).toEqual(sorted([SILENT, SLOW, CONTRACTOR]));
		expect(sent.every((s) => s.channel === "push")).toBe(true);
		const slow = sent.find((s) => s.userId === SLOW);
		expect(slow?.title).toBe("Don't forget to log your hours");
		expect(slow?.body).toBe(
			`You've logged ${formatDurationShort(4 * H)} of ${formatDurationShort(8 * H)} expected today.`,
		);

		// Once a day.
		sent = [];
		await logAt(TUESDAY, "17:30");
		expect(sent).toHaveLength(0);
	});

	test("the nudge: Tuesday and Friday from 09:00, to the people the rule calls behind", async () => {
		await slackAt(TUESDAY, "08:45");
		expect(sent).toHaveLength(0);

		await slackAt(TUESDAY, "09:00");
		// 9 of April's 22 working days have passed before Tuesday the 14th (today
		// itself is still in progress): the target so far is 72h of the 176h
		// fund. SILENT has 0, SLOW 40 — both behind. CONTRACTOR is hourly with no
		// override, so no target and no nudge.
		expect(reached("compliance-nudge")).toEqual(sorted([SILENT, SLOW]));
		expect(titleFor("compliance-nudge", SILENT)).toBe(
			"No time logged yet this month",
		);
		expect(titleFor("compliance-nudge", SLOW)).toBe(
			"You're behind on your hours this month",
		);
		// The numbers are the report's own, in hours a person reads.
		expect(bodyFor("compliance-nudge", SLOW)).toBe(
			"You've logged 40h of the 72h expected by today, 32h short.",
		);
		expect(sentTo("compliance-nudge", SLOW)?.slack).toBeUndefined();

		sent = [];
		await slackAt(TUESDAY, "09:15");
		expect(sent).toHaveLength(0);

		await slackAt(WEDNESDAY, "09:00");
		expect(reached("compliance-nudge")).toEqual([]);

		await slackAt(FRIDAY, "09:00");
		expect(reached("compliance-nudge")).toEqual(sorted([SILENT, SLOW]));
	});

	test("the digest: Tuesday only, to the admins", async () => {
		await slackAt(TUESDAY, "09:00");
		expect(reached("admin-digest")).toEqual([ADMIN]);
		expect(titleFor("admin-digest", ADMIN)).toBe("Time tracking this week");
		const digest = bodyFor("admin-digest", ADMIN) ?? "";
		// SILENT, SLOW and NEVER are behind: the cohort's verdicts, not only who
		// gets a DM. CONTRACTOR has no target and is not in the digest at all.
		expect(digest).toContain("3 people are behind for the month:");
		expect(digest).toContain("• silent — 0h of 72h (72h short)");
		expect(digest).toContain("• slow — 40h of 72h (32h short)");
		expect(digest).toContain("• never — 0h of 72h (72h short)");
		expect(digest).not.toContain("contractor");
		expect(digest).not.toContain("slightly behind");

		sent = [];
		await slackAt(FRIDAY, "09:00");
		expect(reached("admin-digest")).toEqual([]);
	});

	test("month-end: the last working day, to the whole cohort", async () => {
		await slackAt(DAY_BEFORE_MONTH_END, "09:00");
		expect(reached("month-end")).toEqual([]);

		await slackAt(MONTH_END, "09:00");
		expect(reached("month-end")).toEqual(
			sorted([ADMIN, SILENT, SLOW, CONTRACTOR]),
		);
		expect(titleFor("month-end", ADMIN)).toBe(
			"Today is the last working day of the month",
		);
		// Somebody on pace gets the ask alone; the others get their own numbers.
		expect(bodyFor("month-end", ADMIN)).toBe(
			"Anything still unlogged needs to go in before the month ends tomorrow.",
		);
		expect(bodyFor("month-end", SILENT)).toBe(
			"You haven't logged any time this month yet. Anything still unlogged needs to go in before the month ends tomorrow.",
		);
		// The last working day of the month itself is still in progress, so the
		// target so far is the 21 working days before it (168h), not the whole
		// 176h fund.
		expect(bodyFor("month-end", SLOW)).toBe(
			"You've logged 88h of the 168h expected so far. Anything still unlogged needs to go in before the month ends tomorrow.",
		);
	});
});

describe("the digest mentions people", () => {
	test("in Slack, by their Slack id, and keeps plain names elsewhere", async () => {
		await db
			.insert(memberSlackIdentity)
			.values({ organizationId: ORG, userId: SILENT, slackUserId: "U0SILENT" });
		await slackAt(TUESDAY, "09:00");
		const got = sentTo("admin-digest", ADMIN);
		expect(got?.slack).toStartWith(
			"*Time tracking this week*\n*3 people* are behind for the month:",
		);
		expect(got?.slack).toContain("• <@U0SILENT> — 0h of 72h (72h short)");
		// Nobody matched SLOW to Slack, so the name stays.
		expect(got?.slack).toContain("• slow — 40h of 72h (32h short)");
		// The plain form, which the preview shows, never carries the markup.
		expect(got?.body).toContain("• silent — 0h of 72h (72h short)");
		expect(got?.body).not.toContain("<@");
	});
});

describe("the month-end reminder replaces the nudge on its day", () => {
	test("for everyone it reaches, and only them", async () => {
		// April 30 is a Thursday, so the nudge and month-end fall on one day.
		await configure({ nudgeWeekdays: [4] });
		await slackAt(MONTH_END, "09:00");
		expect(reached("month-end")).toEqual(
			sorted([ADMIN, SILENT, SLOW, CONTRACTOR]),
		);
		expect(reached("compliance-nudge")).toEqual([]);

		// The people the month-end reminder skips still get the nudge.
		await configure({ monthEndMemberTypes: ["contractor_hourly"] });
		forgetSlackReminderRunsForTests();
		await db.delete(slackReminderLog);
		sent = [];
		await slackAt(MONTH_END, "09:00");
		expect(reached("month-end")).toEqual([CONTRACTOR]);
		expect(reached("compliance-nudge")).toEqual(sorted([SILENT, SLOW]));
	});
});

describe("days, time and conditions must all apply", () => {
	test("the nudge goes out on its own days, from its own time", async () => {
		await configure({ nudgeWeekdays: [3], nudgeTime: "10:00" });

		await slackAt(TUESDAY, "10:00");
		expect(reached("compliance-nudge")).toEqual([]);
		await slackAt(WEDNESDAY, "09:45");
		expect(reached("compliance-nudge")).toEqual([]);
		await slackAt(WEDNESDAY, "10:00");
		expect(reached("compliance-nudge")).toEqual(sorted([SILENT, SLOW]));
	});

	test("the tolerance decides who is only slightly behind, and they are not nudged", async () => {
		// SLOW has 40h of 72h. At the default 5% that is behind; at 50% it is
		// within the tolerance — slightly behind — and the nudge leaves them be.
		await orgSettingsService.update(adminCtx(), { trackingTolerancePct: 50 });
		await slackAt(TUESDAY, "09:00");
		expect(reached("compliance-nudge")).toEqual([SILENT]);
	});

	test("the nudge never goes out on a weekend or a public holiday", async () => {
		await configure({ nudgeWeekdays: [6] });
		await slackAt("2026-04-18", "09:00"); // Saturday
		expect(reached("compliance-nudge")).toEqual([]);

		// Memorial Day 2026 (Monday 25 May) is a public holiday in this org's
		// country. With a fund for May everyone who logged nothing is behind, so
		// the day is the only thing standing between them and a DM.
		await db.insert(monthlyHourFund).values({
			organizationId: ORG,
			year: 2026,
			month: 5,
			fundSeconds: 168 * H,
		});
		await configure({ nudgeWeekdays: [1, 2] });
		await slackAt("2026-05-25", "09:00");
		expect(reached("compliance-nudge")).toEqual([]);
		// ADMIN logged April, not May, so in May they are behind too.
		await slackAt("2026-05-26", "09:00");
		expect(reached("compliance-nudge")).toEqual(sorted([ADMIN, SILENT, SLOW]));
	});

	test("the nudge goes only to the chosen person types — and never to somebody with no target", async () => {
		await configure({ nudgeMemberTypes: ["contractor_hourly"] });
		await slackAt(TUESDAY, "09:00");
		// CONTRACTOR is the only one of that type, and has no target.
		expect(reached("compliance-nudge")).toEqual([]);
	});

	test("a fixed log-reminder time replaces the end of the workday", async () => {
		await configure({ logMode: "fixed", logTime: "12:00" });
		await logAt(TUESDAY, "11:45");
		expect(sent).toHaveLength(0);
		await logAt(TUESDAY, "12:00");
		expect(reached("log-reminder")).toEqual(sorted([SILENT, SLOW, CONTRACTOR]));
	});

	test("the log reminder waits for the share of the day it is set to", async () => {
		await configure({ logBelowPct: 50 });
		await logAt(TUESDAY, "17:00");
		// SLOW logged exactly half the day: not below 50%.
		expect(reached("log-reminder")).toEqual(sorted([SILENT, CONTRACTOR]));
	});

	test("month-end N working days before the last one", async () => {
		await configure({ monthEndDaysBefore: 1 });
		await slackAt(MONTH_END, "09:00");
		expect(reached("month-end")).toEqual([]);
		await slackAt(DAY_BEFORE_MONTH_END, "09:00");
		expect(reached("month-end")).toEqual(
			sorted([ADMIN, SILENT, SLOW, CONTRACTOR]),
		);
		expect(titleFor("month-end", ADMIN)).toBe(
			"Tomorrow is the last working day of the month",
		);
		expect(bodyFor("month-end", ADMIN)).toBe(
			"Anything still unlogged needs to go in before the month ends.",
		);
	});

	test("month-end for people behind pace only, of the chosen types", async () => {
		await configure({ monthEndOnlyBehind: true });
		await slackAt(MONTH_END, "09:00");
		expect(reached("month-end")).toEqual(sorted([SILENT, SLOW]));

		await configure({
			monthEndOnlyBehind: false,
			monthEndMemberTypes: ["employee_billable"],
		});
		forgetSlackReminderRunsForTests();
		await db.delete(slackReminderLog);
		sent = [];
		await slackAt(MONTH_END, "09:00");
		expect(reached("month-end")).toEqual(sorted([ADMIN, SILENT, SLOW]));
	});

	test("month-end waits for its time", async () => {
		await configure({ monthEndTime: "11:00" });
		await slackAt(MONTH_END, "10:45");
		expect(reached("month-end")).toEqual([]);
		await slackAt(MONTH_END, "11:00");
		expect(reached("month-end")).toHaveLength(4);
	});

	test("the digest goes out on its own day and time", async () => {
		await configure({ digestWeekday: 5, digestTime: "08:00" });
		await slackAt(TUESDAY, "09:00");
		expect(reached("admin-digest")).toEqual([]);
		await slackAt(FRIDAY, "07:45");
		expect(reached("admin-digest")).toEqual([]);
		await slackAt(FRIDAY, "08:00");
		expect(reached("admin-digest")).toEqual([ADMIN]);
	});

	test("a reminder that is off sends nothing", async () => {
		await configure({
			logEnabled: false,
			nudgeEnabled: false,
			monthEndEnabled: false,
			digestEnabled: false,
		});
		await logAt(TUESDAY, "17:00");
		await slackAt(TUESDAY, "09:00");
		await slackAt(MONTH_END, "09:00");
		expect(sent).toHaveLength(0);
	});
});

describe("people who have never signed in", () => {
	test("get nothing while the setting is off (the default)", async () => {
		await logAt(TUESDAY, "17:00");
		await slackAt(TUESDAY, "09:00");
		await slackAt(MONTH_END, "09:00");
		expect(sent.some((s) => s.userId === NEVER)).toBe(false);
	});

	test("get their reminders once it is on", async () => {
		await configure({ includeNeverSignedIn: true });
		await logAt(TUESDAY, "17:00");
		await slackAt(TUESDAY, "09:00");
		await slackAt(MONTH_END, "09:00");
		expect(reached("log-reminder")).toContain(NEVER);
		expect(reached("compliance-nudge")).toContain(NEVER);
		expect(reached("month-end")).toContain(NEVER);
	});

	test("are not claimed while held back, so turning it on reaches them today", async () => {
		await slackAt(TUESDAY, "09:00");
		expect(reached("compliance-nudge")).not.toContain(NEVER);

		await configure({ includeNeverSignedIn: true });
		forgetSlackReminderRunsForTests();
		await slackAt(TUESDAY, "09:15");
		expect(reached("compliance-nudge")).toContain(NEVER);
	});
});

describe("archived people", () => {
	test("get no reminder of any kind, whatever the settings", async () => {
		await configure({ includeNeverSignedIn: true });
		await logAt(TUESDAY, "17:00");
		await slackAt(TUESDAY, "09:00");
		await slackAt(MONTH_END, "09:00");
		// Every kind went out to somebody, so the archived admin had every
		// chance to be picked.
		for (const kind of [
			"log-reminder",
			"compliance-nudge",
			"admin-digest",
			"month-end",
		] as const) {
			expect(reached(kind).length).toBeGreaterThan(0);
			expect(reached(kind)).not.toContain(ARCHIVED);
		}
	});

	test("notify refuses every reminder kind, and still sends a non-reminder kind", async () => {
		for (const kind of [
			"log-reminder",
			"compliance-nudge",
			"admin-digest",
			"month-end",
		] as const) {
			const outcome = await notify(
				{ organizationId: ORG, userId: ARCHIVED },
				{ kind, title: "t", body: "b" },
			);
			expect(wasDelivered(outcome)).toBe(false);
		}
		const other = await notify(
			{ organizationId: ORG, userId: ARCHIVED },
			{ kind: "test", title: "Heads up", body: "detail" },
		);
		expect(wasDelivered(other)).toBe(true);
	});
});

describe("the preview names the people the job sends to", () => {
	const cases: [ReminderKind, string, string, "log" | "slack"][] = [
		["log-reminder", TUESDAY, "17:00", "log"],
		["compliance-nudge", TUESDAY, "09:00", "slack"],
		["admin-digest", TUESDAY, "09:00", "slack"],
		["month-end", MONTH_END, "09:00", "slack"],
	];
	for (const [kind, day, time, job] of cases) {
		test(kind, async () => {
			const preview = await reminderSettingsService.preview(
				adminCtx(),
				kind,
				day,
			);
			if (job === "log") await logAt(day, time);
			else await slackAt(day, time);

			expect(preview.skipped).toBeNull();
			expect(sorted(preview.recipients.map((r) => r.userId))).toEqual(
				reached(kind),
			);
			// And the words: the preview shows what the job sent.
			for (const recipient of preview.recipients) {
				const got = sent.find(
					(s) => s.kind === kind && s.userId === recipient.userId,
				);
				expect(recipient.message).toBe(
					got?.title ? `${got.title}. ${got.body}` : (got?.body ?? ""),
				);
			}
		});
	}

	test("and says who is held back, and why", async () => {
		const preview = await reminderSettingsService.preview(
			adminCtx(),
			"log-reminder",
			TUESDAY,
		);
		expect(preview.heldBack.map((p) => [p.userId, p.reason]).sort()).toEqual([
			[ARCHIVED, "Archived"],
			[NEVER, "Has never signed in"],
		]);
	});

	test("and why nothing goes out on a day that is not the reminder's", async () => {
		const preview = await reminderSettingsService.preview(
			adminCtx(),
			"compliance-nudge",
			WEDNESDAY,
		);
		expect(preview.skipped).toBe("This day is not a nudge day.");
		expect(preview.recipients).toEqual([]);
	});

	test("is for admins only", async () => {
		expect(
			reminderSettingsService.preview(
				{ organizationId: ORG, userId: SILENT },
				"compliance-nudge",
				TUESDAY,
			),
		).rejects.toThrow(AccessError);
	});
});

describe("the settings", () => {
	test("a missing row is the defaults", async () => {
		expect(await reminderSettingsService.get(adminCtx())).toEqual(
			REMINDER_SETTINGS_DEFAULTS,
		);
	});

	test("a save touches only its own fields", async () => {
		await configure({ nudgeTime: "10:30" });
		await configure({ digestEnabled: false });
		const saved = await reminderSettingsService.get(adminCtx());
		expect(saved.nudgeTime).toBe("10:30");
		expect(saved.digestEnabled).toBe(false);
		expect(saved.logMode).toBe("end_of_day");
	});

	test("the service stores a set of days, sorted", async () => {
		await configure({ nudgeWeekdays: [5, 2, 5] });
		expect(
			(await reminderSettingsService.get(adminCtx())).nudgeWeekdays,
		).toEqual([2, 5]);
	});

	test("only an admin may change them", async () => {
		expect(
			reminderSettingsService.update(
				{ organizationId: ORG, userId: SILENT },
				{ nudgeTime: "10:00" },
			),
		).rejects.toThrow(AccessError);
	});
});

describe("the limits", () => {
	const accepts = (patch: UpdateReminderSettingsInput) =>
		updateReminderSettingsInput.safeParse(patch).success;

	test("at most three nudge days a week", () => {
		expect(accepts({ nudgeWeekdays: [1, 3, 5] })).toBe(true);
		expect(accepts({ nudgeWeekdays: [1, 2, 3, 5] })).toBe(false);
		expect(accepts({ nudgeWeekdays: [] })).toBe(false);
	});

	test("nothing from 20:00 to 07:00, on a quarter hour", () => {
		expect(accepts({ nudgeTime: "22:00" })).toBe(false);
		expect(accepts({ logTime: "06:45" })).toBe(false);
		expect(accepts({ digestTime: "20:15" })).toBe(false);
		expect(accepts({ monthEndTime: "09:10" })).toBe(false);
		expect(accepts({ nudgeTime: "07:00" })).toBe(true);
		expect(accepts({ nudgeTime: "20:00" })).toBe(true);
	});

	test("the database refuses the same writes", async () => {
		const refusal = async (write: () => Promise<void>) => {
			try {
				await write();
				return "";
			} catch (error) {
				return error instanceof Error
					? `${error.message} ${String(error.cause)}`
					: String(error);
			}
		};
		expect(
			await refusal(async () => {
				await db
					.insert(reminderSettings)
					.values({ organizationId: ORG, nudgeWeekdays: [1, 2, 3, 5] });
			}),
		).toContain("reminder_settings_nudge_weekdays_valid");
		expect(
			await refusal(async () => {
				await db
					.insert(reminderSettings)
					.values({ organizationId: ORG, nudgeTime: "22:00" });
			}),
		).toContain("reminder_settings_nudge_time_valid");
	});
});
