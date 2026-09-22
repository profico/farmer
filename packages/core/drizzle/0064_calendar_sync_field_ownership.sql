ALTER TABLE "time_entry" ADD COLUMN "synced_date" text;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "synced_duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "synced_description" text;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "meeting_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "calendar_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "calendar_change_from" jsonb;--> statement-breakpoint
-- A row the engine still owned mirrors the calendar as of its last sync, so what
-- it holds IS the baseline. A row the person took over (sync_locked) is left
-- null on purpose: its day or length may be theirs or may be the calendar's, and
-- a null baseline keeps whatever differs from the calendar rather than guessing.
UPDATE "time_entry"
SET "synced_date" = "date",
    "synced_duration_seconds" = "duration_seconds",
    "synced_description" = "description"
WHERE "calendar_event_id" IS NOT NULL AND "sync_locked" = false;
