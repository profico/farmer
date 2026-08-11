CREATE TABLE "slack_reminder_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"day_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_reminder_log_unq" UNIQUE("organization_id","recipient_user_id","kind","day_key")
);
--> statement-breakpoint
ALTER TABLE "slack_reminder_log" ADD CONSTRAINT "slack_reminder_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_reminder_log" ADD CONSTRAINT "slack_reminder_log_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "srl_org_day_idx" ON "slack_reminder_log" USING btree ("organization_id","day_key");