import {
	boolean,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { project } from "./domain";

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

// A single browser/device Web Push subscription. Per-user and NOT org-scoped:
// the endpoint identifies a device+browser, and one device serves the user
// across every org they belong to (the payload carries the org deep-link).
// A user can hold several (laptop, phone, second browser), so the row is keyed
// on the unique push `endpoint`, not on the user.
export const pushSubscription = pgTable("push_subscription", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	endpoint: text("endpoint").notNull().unique(),
	// The two keys the push service needs to encrypt payloads (RFC 8291).
	p256dh: text("p256dh").notNull(),
	auth: text("auth").notNull(),
	userAgent: text("user_agent"),
	createdAt: ts("created_at").notNull().defaultNow(),
});

// Per-member, per-org notification preferences. Like integrationSettings, a
// missing row means "defaults" (see notificationsService.getSettings). Both
// toggles default ON because the real opt-in gate is the OS-level notification
// permission the user must grant on their device before any push can arrive —
// once granted, the sensible default is that it just works. Keyed (org, user)
// because the same person may want reminders in one org but not another.
export const notificationSettings = pgTable(
	"notification_settings",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		logReminders: boolean("log_reminders").notNull().default(true),
		// The org-day-key (yyyy-MM-dd, resolved in the org timezone) we last sent
		// this user a "forgot to log" reminder for. Lets the once-a-day scheduler
		// stay idempotent across ticks and process restarts.
		lastLogReminderDay: text("last_log_reminder_day"),
		// Same idempotency trick for the two Slack channels (PRD §7): the org-day
		// key of the last compliance nudge (max 2/week, Tue + Fri) and of the last
		// month-end "close is coming" push. Separate columns because the month-end
		// push must fire even on a day a nudge already went out.
		lastSlackNudgeDay: text("last_slack_nudge_day"),
		lastMonthEndPushDay: text("last_month_end_push_day"),
		...stamps,
	},
	(t) => [
		unique("notification_settings_org_user_unq").on(
			t.organizationId,
			t.userId,
		),
	],
);

// One row per (Fixed Scope project, threshold) that has already been announced,
// so the 80%/100% budget alerts (PRD 6.6) fire once each rather than on every
// tick of the scheduler. The row is deleted again if burn falls back under the
// threshold — raising a budget mid-project should re-arm the alarm, not silence
// it forever.
export const projectBudgetAlert = pgTable(
	"project_budget_alert",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		/** 80 or 100. An integer rather than an enum so a third step is a one-line
		 *  change if the product ever wants one. */
		threshold: integer("threshold").notNull(),
		notifiedAt: ts("notified_at").notNull().defaultNow(),
	},
	(t) => [unique("project_budget_alert_unq").on(t.projectId, t.threshold)],
);
