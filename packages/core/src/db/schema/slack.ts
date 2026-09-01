import {
	index,
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

// One Slack workspace per org (PRD §8). The bot token is the credential every
// reminder DM is sent with; it is written once at install and never exposed to
// the client — no server function or REST route returns it.
export const slackInstallation = pgTable(
	"slack_installation",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		teamId: text("team_id").notNull(),
		teamName: text("team_name"),
		botToken: text("bot_token").notNull(),
		botUserId: text("bot_user_id"),
		installedByUserId: text("installed_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		...stamps,
	},
	(t) => [unique("slack_installation_org_unq").on(t.organizationId)],
);

// Maps a person to their Slack user id so the bot can open a DM. Resolved by
// email lookup against the workspace at install time and refreshable later; a
// missing row simply means that person receives no Slack nudges.
export const memberSlackIdentity = pgTable(
	"member_slack_identity",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		slackUserId: text("slack_user_id").notNull(),
		...stamps,
	},
	(t) => [
		unique("member_slack_identity_org_user_unq").on(t.organizationId, t.userId),
		index("msi_org_idx").on(t.organizationId),
	],
);

// What the reminder job has already sent. The scheduler ticks far more often
// than reminders fire, so this is what makes the job idempotent: a row is
// claimed per (org, recipient, kind, day) and a duplicate insert is a no-op.
// Every reminder is a DM, so the recipient is never null — which also keeps the
// unique constraint meaningful (Postgres lets NULLs collide freely).
export const slackReminderLog = pgTable(
	"slack_reminder_log",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		recipientUserId: text("recipient_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** "nudge" | "month_end" | "admin_digest" — free text, not an enum, so a
		 *  new reminder kind doesn't need a migration. */
		kind: text("kind").notNull(),
		/** Org-timezone day key (yyyy-MM-dd) the send belongs to. */
		dayKey: text("day_key").notNull(),
		createdAt: ts("created_at").notNull().defaultNow(),
	},
	(t) => [
		unique("slack_reminder_log_unq").on(
			t.organizationId,
			t.recipientUserId,
			t.kind,
			t.dayKey,
		),
		index("srl_org_day_idx").on(t.organizationId, t.dayKey),
	],
);
