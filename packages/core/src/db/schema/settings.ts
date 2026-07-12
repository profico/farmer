import {
	boolean,
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
		googleSyncTimeOff: boolean("google_sync_time_off").notNull().default(false),
		// GitHub
		githubAutoLoadCommits: boolean("github_auto_load_commits")
			.notNull()
			.default(false),
		githubSyncCommitsAsWorkTime: boolean("github_sync_commits_as_work_time")
			.notNull()
			.default(false),
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
