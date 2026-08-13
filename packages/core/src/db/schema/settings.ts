import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

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
	(t) => [unique("integration_settings_org_user_unq").on(t.organizationId, t.userId)],
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

// Org-wide knobs (PRD §8). One row per org; a missing row implies the column
// defaults (see orgSettingsService.get) so no backfill is needed.
// Deliberately NOT configurable and therefore absent here: the behind-pace
// threshold (~90%), the reminder days (Tue/Fri), the 15-minute entry
// granularity and the close lifecycle.
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

// The fixed status set for the "not on the invoice" report (6.7). Deliberately a
// managed list rather than free text: it makes the report a trend instrument
// over time (bench hours per month, time-to-billable per person) instead of a
// one-off email. Defaults seeded per org: Bench / Internal work / Onboarding /
// Leave / Ramping onto project.
export const notOnInvoiceStatusOption = pgTable(
	"not_on_invoice_status_option",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		label: text("label").notNull(),
		sortOrder: integer("sort_order").notNull().default(0),
		archivedAt: ts("archived_at"),
		...stamps,
	},
	(t) => [index("noiso_org_idx").on(t.organizationId)],
);

// The Admin's judgment layer on top of the generated list: for each person the
// report surfaces for a month, a status from the set above plus an optional
// comment. The list itself is derived (every billable person with zero Final
// hours on any non-Internal project), so only the annotation is stored.
export const notOnInvoiceEntry = pgTable(
	"not_on_invoice_entry",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		year: integer("year").notNull(),
		month: integer("month").notNull(), // 1-12
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// set null so retiring a status option never deletes the historical note.
		statusOptionId: uuid("status_option_id").references(
			() => notOnInvoiceStatusOption.id,
			{ onDelete: "set null" },
		),
		comment: text("comment"),
		...stamps,
	},
	(t) => [
		unique("not_on_invoice_entry_unq").on(
			t.organizationId,
			t.year,
			t.month,
			t.userId,
		),
		check(
			"not_on_invoice_entry_month_valid",
			sql`${t.month} >= 1 and ${t.month} <= 12`,
		),
	],
);
