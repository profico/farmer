ALTER TABLE "slack_reminder_log" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_reminder_log" ADD COLUMN "retry" boolean DEFAULT false NOT NULL;