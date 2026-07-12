ALTER TABLE "time_entry" DROP CONSTRAINT "running_or_complete";--> statement-breakpoint
DROP INDEX "one_running_timer_per_user";--> statement-breakpoint
ALTER TABLE "time_entry" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ALTER COLUMN "stopped_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ALTER COLUMN "duration_seconds" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" DROP COLUMN "source";--> statement-breakpoint
DROP TYPE "public"."time_entry_source";