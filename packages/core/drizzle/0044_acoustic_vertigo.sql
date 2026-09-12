DROP TABLE "monthly_close" CASCADE;--> statement-breakpoint
DROP TABLE "monthly_close_row" CASCADE;--> statement-breakpoint
ALTER TABLE "import_run" DROP COLUMN "closes_created";--> statement-breakpoint
DROP TYPE "public"."close_status";