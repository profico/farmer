ALTER TABLE "assistant_message" ADD COLUMN "undo" jsonb;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD COLUMN "undone_at" timestamp with time zone;