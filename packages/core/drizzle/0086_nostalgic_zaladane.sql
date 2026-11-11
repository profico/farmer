ALTER TABLE "assistant_conversation" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN "shared_by" text;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_shared_by_user_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;