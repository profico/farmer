ALTER TABLE "running_timer" ADD COLUMN "running_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "running_timer" ADD COLUMN "accumulated_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Every timer that exists at this point is running: a pause had no way to
-- happen before this migration. Without this line each of them would read as
-- paused, and its figure would stop where the deployment found it.
UPDATE "running_timer" SET "running_since" = "started_at" WHERE "dropped_at" IS NULL;
