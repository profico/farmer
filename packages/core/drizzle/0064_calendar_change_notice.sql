ALTER TABLE "time_entry" ADD COLUMN "calendar_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "calendar_change_from" jsonb;