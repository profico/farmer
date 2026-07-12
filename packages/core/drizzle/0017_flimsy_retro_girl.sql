CREATE TYPE "public"."time_off_type" AS ENUM('vacation', 'sick', 'personal', 'unpaid', 'other');--> statement-breakpoint
CREATE TABLE "disabled_holiday" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disabled_holiday_org_name_unq" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "member_time_off_allowance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"allowance_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_time_off_allowance_org_user_unq" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "time_off_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"default_allowance_days" integer DEFAULT 20 NOT NULL,
	"carryover_enabled" boolean DEFAULT true NOT NULL,
	"carryover_max_days" integer,
	"carryover_expiry_month" integer DEFAULT 3 NOT NULL,
	"carryover_expiry_day" integer DEFAULT 31 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_off_policy_org_unq" UNIQUE("organization_id"),
	CONSTRAINT "time_off_policy_expiry_month_valid" CHECK ("time_off_policy"."carryover_expiry_month" >= 1 and "time_off_policy"."carryover_expiry_month" <= 12),
	CONSTRAINT "time_off_policy_expiry_day_valid" CHECK ("time_off_policy"."carryover_expiry_day" >= 1 and "time_off_policy"."carryover_expiry_day" <= 31)
);
--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "is_vacation_approver" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time_off_request" ADD COLUMN "type" time_off_type DEFAULT 'vacation' NOT NULL;--> statement-breakpoint
ALTER TABLE "time_off_request" ADD COLUMN "reviewer_user_id" text;--> statement-breakpoint
ALTER TABLE "disabled_holiday" ADD CONSTRAINT "disabled_holiday_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_time_off_allowance" ADD CONSTRAINT "member_time_off_allowance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_time_off_allowance" ADD CONSTRAINT "member_time_off_allowance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_policy" ADD CONSTRAINT "time_off_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_request" ADD CONSTRAINT "time_off_request_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;