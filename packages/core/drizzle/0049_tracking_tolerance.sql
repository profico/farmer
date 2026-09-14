-- The Tracking rule (Sept 2026) has one knob, the tolerance, on org_settings.
-- It replaces the "no entries for N working days" count and the reminders'
-- behind-pace percentage: who is behind is now the rule's verdict, read by the
-- report and every reminder alike. Hand-written: drizzle-kit cannot tell a
-- replaced column from a renamed one without a prompt.
ALTER TABLE "org_settings" DROP CONSTRAINT IF EXISTS "org_settings_missing_days_valid";--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "tracking_tolerance_pct" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" DROP COLUMN "compliance_missing_days";--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_tolerance_valid" CHECK ("org_settings"."tracking_tolerance_pct" >= 0 and "org_settings"."tracking_tolerance_pct" <= 50);--> statement-breakpoint
ALTER TABLE "reminder_settings" DROP CONSTRAINT IF EXISTS "reminder_settings_behind_pace_pct_valid";--> statement-breakpoint
ALTER TABLE "reminder_settings" DROP COLUMN "nudge_no_entries";--> statement-breakpoint
ALTER TABLE "reminder_settings" DROP COLUMN "nudge_behind_pace";--> statement-breakpoint
ALTER TABLE "reminder_settings" DROP COLUMN "nudge_behind_pace_pct";
