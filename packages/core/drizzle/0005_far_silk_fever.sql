CREATE TYPE "public"."time_off_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TABLE "member_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"weekly_target_seconds" integer DEFAULT 144000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_schedule_org_user_unq" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "member_working_hours_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"day_of_week" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"start_time" text,
	"end_time" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mwhd_org_user_day_unq" UNIQUE("organization_id","user_id","day_of_week"),
	CONSTRAINT "mwhd_day_of_week_valid" CHECK ("member_working_hours_day"."day_of_week" >= 0 and "member_working_hours_day"."day_of_week" <= 6)
);
--> statement-breakpoint
CREATE TABLE "time_off_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"label" text,
	"status" time_off_status DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" text,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_schedule" ADD CONSTRAINT "member_schedule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_schedule" ADD CONSTRAINT "member_schedule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_working_hours_day" ADD CONSTRAINT "member_working_hours_day_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_working_hours_day" ADD CONSTRAINT "member_working_hours_day_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_request" ADD CONSTRAINT "time_off_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_request" ADD CONSTRAINT "time_off_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_request" ADD CONSTRAINT "time_off_request_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tor_org_user_start_idx" ON "time_off_request" USING btree ("organization_id","user_id","start_date");--> statement-breakpoint
CREATE INDEX "tor_org_status_idx" ON "time_off_request" USING btree ("organization_id","status");