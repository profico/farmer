CREATE TABLE "synced_meeting_tombstone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"calendar_event_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "smt_org_user_event_unq" UNIQUE("organization_id","user_id","calendar_event_id")
);
--> statement-breakpoint
ALTER TABLE "time_off_request" ADD COLUMN "google_calendar_event_id" text;--> statement-breakpoint
ALTER TABLE "synced_meeting_tombstone" ADD CONSTRAINT "synced_meeting_tombstone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_meeting_tombstone" ADD CONSTRAINT "synced_meeting_tombstone_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "te_calendar_event_uidx" ON "time_entry" USING btree ("organization_id","user_id","calendar_event_id") WHERE "time_entry"."calendar_event_id" is not null;