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
		type: "contractor" as const,
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

	test("the nudge: Tuesday and Friday from 09:00, no-entries wording first", async () => {
		await slackAt(TUESDAY, "08:45");
		expect(sent).toHaveLength(0);

		await slackAt(TUESDAY, "09:00");
		expect(reached("compliance-nudge")).toEqual(
			sorted([SILENT, SLOW, CONTRACTOR]),
		);
		// SILENT is on both lists; the no-entries message wins.
		expect(titleFor("compliance-nudge", SILENT)).toBe("No time logged yet");
		expect(titleFor("compliance-nudge", SLOW)).toBe(
			"You're at 50% of your expected hours so far",
		);
		// The numbers behind the percentage, in hours a person reads.
		expect(bodyFor("compliance-nudge", SLOW)).toMatch(
			/^You've logged \d+h of the \d+h expected by today, \d+h short\.$/,
		);
		expect(sentTo("compliance-nudge", SLOW)?.slack).toBeUndefined();

		sent = [];
		await slackAt(TUESDAY, "09:15");
		expect(sent).toHaveLength(0);

		await slackAt(WEDNESDAY, "09:00");
		expect(reached("compliance-nudge")).toEqual([]);

		await slackAt(FRIDAY, "09:00");
		expect(reached("compliance-nudge")).toEqual(
			sorted([SILENT, SLOW, CONTRACTOR]),
		);
	});

	test("the digest: Tuesday only, to the admins", async () => {
		await slackAt(TUESDAY, "09:00");
		expect(reached("admin-digest")).toEqual([ADMIN]);
		expect(titleFor("admin-digest", ADMIN)).toBe("Time tracking this week");
		const digest = bodyFor("admin-digest", ADMIN) ?? "";
		// SILENT, CONTRACTOR, NEVER: the cohort, not only who gets a DM. Named by
		// when they last logged — never — and not by a count of working days.
		expect(digest).toContain(
			"3 people have logged nothing in the last 3 working days:",
		);
		expect(digest).toContain("• silent — never logged");
		expect(digest).toContain("• never — never logged");
		// SILENT and NEVER are behind too, and already named above; SLOW is only
		// behind, and is the one this list names.
		expect(digest).toContain(
			"3 people are behind pace for the month. Besides the people with nothing logged:",
		);
		expect(digest).toMatch(/• slow — 50% \(\d+h of \d+h\)/);
		expect(digest.match(/• silent/g)).toHaveLength(1);

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
			"Anything still unlogged needs to go in before the monthly close starts tomorrow.",
		);
		expect(bodyFor("month-end", SILENT)).toBe(
			"You haven't logged any time yet. Anything still unlogged needs to go in before the monthly close starts tomorrow.",
		);
		expect(bodyFor("month-end", SLOW)).toMatch(
			/^You've logged \d+h of the \d+h expected so far\. Anything still unlogged/,
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
			"*Time tracking this week*\n*3 people* have logged nothing",
		);
		expect(got?.slack).toContain("• <@U0SILENT> — never logged");
		// Nobody matched CONTRACTOR to Slack, so the name stays.
		expect(got?.slack).toContain("• contractor — never logged");
		// The plain form, which the preview shows, never carries the markup.
		expect(got?.body).toContain("• silent — never logged");
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

		// A contractor the month-end reminder skips still gets the nudge.
		await configure({ monthEndMemberTypes: ["billable"] });
		forgetSlackReminderRunsForTests();
		await db.delete(slackReminderLog);
		sent = [];
		await slackAt(MONTH_END, "09:00");
		expect(reached("compliance-nudge")).toEqual([CONTRACTOR]);
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
		expect(reached("compliance-nudge")).toEqual(
			sorted([SILENT, SLOW, CONTRACTOR]),
		);
	});

	test("with no-entries off, only people behind pace are nudged", async () => {
		await configure({ nudgeNoEntries: false });
		await slackAt(TUESDAY, "09:00");
		expect(reached("compliance-nudge")).toEqual(sorted([SILENT, SLOW]));
		expect(titleFor("compliance-nudge", SILENT)).toBe(
			"You're at 0% of your expected hours so far",
		);
	});

	test("with behind-pace off, only people with no entries are nudged", async () => {
		await configure({ nudgeBehindPace: false });
		await slackAt(TUESDAY, "09:00");
		expect(reached("compliance-nudge")).toEqual(sorted([SILENT, CONTRACTOR]));
	});

	test("with both conditions off, nobody is nudged", async () => {
		await configure({ nudgeNoEntries: false, nudgeBehindPace: false });
		await slackAt(TUESDAY, "09:00");
		expect(reached("compliance-nudge")).toEqual([]);
	});

	test("the behind-pace % decides who is behind", async () => {
		await configure({ nudgeNoEntries: false, nudgeBehindPacePct: 40 });
		await slackAt(TUESDAY, "09:00");
		// SLOW is at 50%: behind at 90, not at 40.
		expect(reached("compliance-nudge")).toEqual([SILENT]);
	});

	test("the nudge goes only to the chosen person types", async () => {
		await configure({ nudgeMemberTypes: ["contractor"] });
		await slackAt(TUESDAY, "09:00");
		expect(reached("compliance-nudge")).toEqual([CONTRACTOR]);
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
			"Anything still unlogged needs to go in before the monthly close starts.",
		);
	});

	test("month-end for people behind pace only, of the chosen types", async () => {
		await configure({ monthEndOnlyBehind: true });
		await slackAt(MONTH_END, "09:00");
		expect(reached("month-end")).toEqual(sorted([SILENT, SLOW]));

		await configure({
			monthEndOnlyBehind: false,
			monthEndMemberTypes: ["billable"],
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

	test("notify refuses every reminder kind, and still sends a budget alert", async () => {
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
		const alert = await notify(
			{ organizationId: ORG, userId: ARCHIVED },
			{ kind: "budget-alert", title: "Over budget", body: "detail" },
		);
		expect(wasDelivered(alert)).toBe(true);
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

	test("the no-entries N is the compliance report's own", async () => {
		await configure({ complianceMissingDays: 5 });
		expect(
			(await orgSettingsService.get(adminCtx())).complianceMissingDays,
		).toBe(5);
		expect(
			(await reminderSettingsService.get(adminCtx())).complianceMissingDays,
		).toBe(5);
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
