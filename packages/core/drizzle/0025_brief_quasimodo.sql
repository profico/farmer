ALTER TABLE "integration_settings" ADD COLUMN "google_auto_sync_meetings_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_settings" ADD COLUMN "github_sync_commits_as_work_time_since" timestamp with time zone;--> statement-breakpoint
-- Backfill: a null floor means "no floor", so every row that predates these
-- columns would keep the old unbounded-past behaviour. The settings row is
-- created by the first toggle anyone flips, so `created_at` is the closest
-- honest answer to "when did automation start for this person" that the data
-- can give. Only rows whose switch is currently ON get a floor; an off switch
-- gets its stamp when it is next turned on.
UPDATE "integration_settings"
SET "google_auto_sync_meetings_since" = "created_at"
WHERE "google_auto_sync_meetings" = true;--> statement-breakpoint
UPDATE "integration_settings"
SET "github_sync_commits_as_work_time_since" = "created_at"
WHERE "github_sync_commits_as_work_time" = true;
