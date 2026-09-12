import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	check,
	index,
	integer,
	pgTable,
	smallint,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { project, task } from "./domain";
import { memberType } from "./people";

const ts = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" });
const org = () =>
	text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" });
const stamps = {
	createdAt: ts("created_at").notNull().defaultNow(),
	updatedAt: ts("updated_at").notNull().defaultNow(),
};

// Per-member, per-org integration preferences. A missing row means "all
// toggles off" (see integrationSettingsService.get), so connecting an account
// never silently opts a user into background syncing — every toggle is
// explicit. Keyed (org, user) because the same user in two orgs may want
// different automation.
export const integrationSettings = pgTable(
	"integration_settings",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// Google Calendar
		googleAutoSyncMeetings: boolean("google_auto_sync_meetings")
			.notNull()
			.default(false),
		// GitHub
		githubAutoLoadCommits: boolean("github_auto_load_commits")
			.notNull()
			.default(false),
		githubSyncCommitsAsWorkTime: boolean("github_sync_commits_as_work_time")
			.notNull()
			.default(false),
		// The day each automation was switched ON, and the floor it may write from.
		// Flipping a switch is a statement about how you want tomorrow to work, not
		// permission to rewrite a year of timesheets — so an engine that finds
		// evidence on an older day leaves that day alone. Set on the false->true
		// transition, cleared on the way back down, so switching off and on again
		// moves the floor rather than reopening the whole past.
		//
		// Null means no floor. Only reachable for rows written before these columns
		// existed, which the migration backfills from `created_at` — the settings
		// row is created by the first toggle, so that IS roughly when automation
		// started for that person.
		googleAutoSyncMeetingsSince: ts("google_auto_sync_meetings_since"),
		githubSyncCommitsAsWorkTimeSince: ts(
			"github_sync_commits_as_work_time_since",
		),
		...stamps,
	},
	(t) => [
		unique("integration_settings_org_user_unq").on(t.organizationId, t.userId),
	],
);

// Records a Google Calendar event the user deleted after it was auto-synced
// into a time entry, so the meeting-sync engine leaves it deleted instead of
// re-importing it on the next read ("stay deleted"). Keyed on the source
// event id; scoped (org, user) because the same event could be relevant to a
// user across orgs independently.
export const syncedMeetingTombstone = pgTable(
	"synced_meeting_tombstone",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		calendarEventId: text("calendar_event_id").notNull(),
		createdAt: ts("created_at").notNull().defaultNow(),
	},
	(t) => [
		unique("smt_org_user_event_unq").on(
			t.organizationId,
			t.userId,
			t.calendarEventId,
		),
	],
);

// The same idea for the commit work-time engine's fill block: a day whose
// "rest of day" block the person deleted.
//
// Every other automation already had a way to be told no — a deleted meeting
// leaves a `syncedMeetingTombstone`, a deleted recurring block leaves a
// `recurringBlockRuleSkip` — and this engine had nothing. Its only guard was
// `te_fill_day_uidx`, which stops a SECOND fill block existing and says nothing
// about one that used to. So deleting the block removed the row the guard was
// reading and the next sweep put it straight back.
//
// It went unnoticed while the engines ran on page load, because you had to
// reload the page to make it happen and it looked like the page had simply not
// caught up. On a 20-minute timer it is a block that will not stay deleted.
//
// Keyed by DAY, not by entry: what the person rejected is "a rest-of-day block
// on this day", and it has to outlive the row they deleted or it means nothing.
// Any fill block counts, not just this engine's — there is no marker
// distinguishing one it wrote from one made by hand, and "I deleted the
// rest-of-day block, don't put another one back" is the right reading of both.
export const commitFillTombstone = pgTable(
	"commit_fill_tombstone",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** yyyy-MM-dd, in the org timezone — the same key `timeEntry.date` uses. */
		date: text("date").notNull(),
		createdAt: ts("created_at").notNull().defaultNow(),
	},
	(t) => [
		unique("cft_org_user_date_unq").on(t.organizationId, t.userId, t.date),
	],
);

// "Always file this meeting to that project." A per-(org, user) standing answer
// to the question the File-your-time dialog asks, so the recurring one — the
// weekly stand-up, the daily — is answered once instead of every month.
//
// Keyed on (task, normalized title), NOT on the calendar event or series: the
// engines resolve tasks by systemKey and identify a meeting by what a person
// sees (see meetingIdentityKeys), and a series that is cancelled and recreated
// is a new event id but the same standing decision. Duration is deliberately
// NOT part of the key even though the dialog groups by it — a stand-up that ran
// long once is still the stand-up.
//
// An empty title cannot carry a rule: the group would fall back to the task
// name, and a rule keyed on "" would claim every untitled meeting the sync ever
// imports. The service refuses to create one.
//
// Per-user, not per-org: the calendar the meetings come from is the person's,
// the entries are theirs, and two people in the same stand-up may well be
// billing it to different projects.
export const filingRule = pgTable(
	"filing_rule",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		taskId: uuid("task_id")
			.notNull()
			.references(() => task.id, { onDelete: "cascade" }),
		/** The match key: the entry description, trimmed and lower-cased. */
		titleKey: text("title_key").notNull(),
		/** The same title as the person actually saw it, for display only. */
		title: text("title").notNull(),
		// cascade, not set null: a rule pointing at a deleted project has no
		// meaning and would silently stop applying anyway.
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		...stamps,
	},
	(t) => [
		index("filing_rule_org_user_idx").on(t.organizationId, t.userId),
		unique("filing_rule_unq").on(
			t.organizationId,
			t.userId,
			t.taskId,
			t.titleKey,
		),
	],
);

// Org-wide knobs (PRD §8). One row per org; a missing row implies the column
// defaults (see orgSettingsService.get) so no backfill is needed.
// Deliberately NOT configurable and therefore absent here: the 15-minute entry
// granularity and the close lifecycle. The reminder days, times and the
// behind-pace threshold the reminders use live in `reminderSettings` below.
export const orgSettings = pgTable(
	"org_settings",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		// N working days without any entry before a person is flagged by the
		// tracking-compliance report (6.2, View 1) and nudged on Slack.
		complianceMissingDays: integer("compliance_missing_days")
			.notNull()
			.default(3),
		// The last day the automations may not write to — yyyy-MM-dd, null (the
		// default) meaning no lock. Everything on or before it is off limits to the
		// recurring block materializer, the calendar sync and the commit work-time
		// engine.
		//
		// It locks the ROBOTS, not the people: entries stay hand-editable in
		// reconciled months on purpose, and this doesn't change that. The point is narrower — once a
		// month has been reconciled and invoiced, nothing should quietly add hours
		// to it while nobody is looking.
		//
		// A single watermark rather than a per-month lock table: "we've closed
		// through July" is what anyone actually means, and locking non-contiguous
		// months isn't a thing to want.
		automationLockedThrough: text("automation_locked_through"),
		...stamps,
	},
	(t) => [
		unique("org_settings_org_unq").on(t.organizationId),
		check(
			"org_settings_missing_days_valid",
			sql`${t.complianceMissingDays} >= 1 and ${t.complianceMissingDays} <= 30`,
		),
	],
);

/** A send time the reminder settings accept: "HH:mm" on a quarter hour, from
 *  07:00 to 20:00. The quarter hour is the Slack job's tick; the window is the
 *  "nothing at night" limit. Mirrors `reminderTime` in schema/reminder-settings. */
const sendTimeValid = (column: AnyPgColumn) =>
	sql`${column} ~ '^([01][0-9]|2[0-3]):(00|15|30|45)$' and ${column} >= '07:00' and ${column} <= '20:00'`;

// When each reminder goes out, and to whom. One row per org; a missing row is
// the column defaults (see reminderSettingsService.get), and the defaults are
// what the jobs did before this table existed — so deploying it changes
// nothing. The one exception is `includeNeverSignedIn`, which is new and off.
//
// These were constants, and "deliberately NOT a setting", on the grounds that
// a reminder sent too often gets muted and a muted reminder is worse than
// none. The owner asked for the settings; the checks below keep that reason:
// at most three nudge days a week, and no send time at night. The Zod input
// says the same thing, and the form shows each limit beside its field.
//
// `complianceMissingDays` (the nudge's "no entries for N working days") is NOT
// here: it stays on `orgSettings`, because the compliance report reads the
// same N and two copies of one number would drift.
export const reminderSettings = pgTable(
	"reminder_settings",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),

		// Log reminder (push). `end_of_day` sends once each person's own
		// scheduled workday is over; `fixed` sends at `logTime` for everyone.
		logEnabled: boolean("log_enabled").notNull().default(true),
		logMode: text("log_mode", { enum: ["end_of_day", "fixed"] })
			.notNull()
			.default("end_of_day"),
		logTime: text("log_time").notNull().default("17:00"),
		// Remind when logged time is below this % of the day's target.
		logBelowPct: smallint("log_below_pct").notNull().default(100),

		// Slack nudge. 0 = Sunday, the same numbering as Date#getDay().
		nudgeEnabled: boolean("nudge_enabled").notNull().default(true),
		nudgeWeekdays: smallint("nudge_weekdays").array().notNull().default([2, 5]),
		nudgeTime: text("nudge_time").notNull().default("09:00"),
		nudgeNoEntries: boolean("nudge_no_entries").notNull().default(true),
		nudgeBehindPace: boolean("nudge_behind_pace").notNull().default(true),
		// "Behind pace" for every reminder: below this % of Expected so far. The
		// month-end "only people behind pace" and the admin digest read it too,
		// so the three never disagree about who is behind.
		nudgeBehindPacePct: smallint("nudge_behind_pace_pct").notNull().default(90),
		nudgeMemberTypes: memberType("nudge_member_types")
			.array()
			.notNull()
			.default(["billable", "contractor"]),

		// Month-end reminder (Slack). 0 = the last working day of the month; N =
		// N working days before it.
		monthEndEnabled: boolean("month_end_enabled").notNull().default(true),
		monthEndDaysBefore: smallint("month_end_days_before").notNull().default(0),
		monthEndTime: text("month_end_time").notNull().default("09:00"),
		monthEndOnlyBehind: boolean("month_end_only_behind")
			.notNull()
			.default(false),
		monthEndMemberTypes: memberType("month_end_member_types")
			.array()
			.notNull()
			.default(["billable", "contractor"]),

		// Admin digest (Slack).
		digestEnabled: boolean("digest_enabled").notNull().default(true),
		digestWeekday: smallint("digest_weekday").notNull().default(2),
		digestTime: text("digest_time").notNull().default("09:00"),

		// Whether a person with no `account` row — somebody an import created,
		// who has never signed in — may get a reminder. Off: they cannot act on
		// one, and most of them are not expecting mail from this app at all.
		// services/notify.ts enforces it, for every reminder kind.
		includeNeverSignedIn: boolean("include_never_signed_in")
			.notNull()
			.default(false),
		...stamps,
	},
	(t) => [
		unique("reminder_settings_org_unq").on(t.organizationId),
		check(
			"reminder_settings_log_mode_valid",
			sql`${t.logMode} in ('end_of_day', 'fixed')`,
		),
		check("reminder_settings_log_time_valid", sendTimeValid(t.logTime)),
		check("reminder_settings_nudge_time_valid", sendTimeValid(t.nudgeTime)),
		check(
			"reminder_settings_month_end_time_valid",
			sendTimeValid(t.monthEndTime),
		),
		check("reminder_settings_digest_time_valid", sendTimeValid(t.digestTime)),
		check(
			"reminder_settings_log_below_pct_valid",
			sql`${t.logBelowPct} >= 1 and ${t.logBelowPct} <= 100`,
		),
		check(
			"reminder_settings_behind_pace_pct_valid",
			sql`${t.nudgeBehindPacePct} >= 1 and ${t.nudgeBehindPacePct} <= 100`,
		),
		// At most three nudge days a week. Four entries fail even when two repeat;
		// the service de-duplicates before it writes.
		check(
			"reminder_settings_nudge_weekdays_valid",
			sql`cardinality(${t.nudgeWeekdays}) between 1 and 3 and ${t.nudgeWeekdays} <@ ARRAY[0,1,2,3,4,5,6]::smallint[]`,
		),
		// Overhead people are never nagged about timesheets (PRD 3.1), so they
		// are not a choice here.
		check(
			"reminder_settings_nudge_member_types_valid",
			sql`cardinality(${t.nudgeMemberTypes}) >= 1 and ${t.nudgeMemberTypes} <@ ARRAY['billable','contractor']::member_type[]`,
		),
		check(
			"reminder_settings_month_end_member_types_valid",
			sql`cardinality(${t.monthEndMemberTypes}) >= 1 and ${t.monthEndMemberTypes} <@ ARRAY['billable','contractor']::member_type[]`,
		),
		check(
			"reminder_settings_month_end_days_before_valid",
			sql`${t.monthEndDaysBefore} >= 0 and ${t.monthEndDaysBefore} <= 10`,
		),
		check(
			"reminder_settings_digest_weekday_valid",
			sql`${t.digestWeekday} >= 0 and ${t.digestWeekday} <= 6`,
		),
	],
);

// The Croatian monthly working-hour fund, currently looked up by hand on
// isplate.info (PRD 3.7). Feeds the Expected formula everywhere it appears:
//   Expected = monthly fund - (absence days x 8)
// Admins can prefill it from the official holiday calendar (roadmap item 5,
// implemented via holidaysService) instead of typing it.
export const monthlyHourFund = pgTable(
	"monthly_hour_fund",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		year: integer("year").notNull(),
		month: integer("month").notNull(), // 1-12
		fundSeconds: integer("fund_seconds").notNull(),
		...stamps,
	},
	(t) => [
		unique("monthly_hour_fund_unq").on(t.organizationId, t.year, t.month),
		check(
			"monthly_hour_fund_month_valid",
			sql`${t.month} >= 1 and ${t.month} <= 12`,
		),
		check("monthly_hour_fund_seconds_valid", sql`${t.fundSeconds} >= 0`),
	],
);
