-- The entry model changes shape here: time entries stop being time-of-day blocks
-- (started_at/stopped_at) and become date + duration, and the taxonomy they hang
-- off moves from `time_entry_type` (dropped below) to the global `task` list.
-- Any pre-existing row therefore has no `date` to backfill and no valid
-- `task_id` to point at — it references a taxonomy that ceases to exist — so the
-- two NOT NULL promotions further down would fail against it. These rows predate
-- the PRD data model and carry no reconcilable meaning under it.
DELETE FROM "time_entry";--> statement-breakpoint
DELETE FROM "recurring_block_rule";--> statement-breakpoint
CREATE TYPE "public"."close_status" AS ENUM('open', 'submitted', 'finalized');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('member', 'team_lead', 'pm');--> statement-breakpoint
CREATE TYPE "public"."project_type" AS ENUM('product_team', 'fixed_scope', 'hourly', 'maintenance', 'internal');--> statement-breakpoint
CREATE TYPE "public"."task_scope" AS ENUM('site', 'organization');--> statement-breakpoint
CREATE TYPE "public"."member_type" AS ENUM('billable', 'overhead', 'contractor');--> statement-breakpoint
CREATE TABLE "monthly_close" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" "close_status" DEFAULT 'open' NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" text,
	"finalized_at" timestamp with time zone,
	"finalized_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_close_unq" UNIQUE("organization_id","project_id","year","month"),
	CONSTRAINT "monthly_close_month_valid" CHECK ("monthly_close"."month" >= 1 and "monthly_close"."month" <= 12)
);
--> statement-breakpoint
CREATE TABLE "monthly_close_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"close_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"adjusted_seconds" integer,
	"final_seconds" integer,
	"absence_days_override" integer,
	"comment" text,
	"reported_at_finalize_seconds" integer,
	"expected_at_finalize_seconds" integer,
	"overtime_at_finalize_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_close_row_unq" UNIQUE("close_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_task_unq" UNIQUE("project_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "member_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"start_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_profile_org_user_unq" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "member_type_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" "member_type" DEFAULT 'billable' NOT NULL,
	"expected_seconds_override" integer,
	"effective_from" text NOT NULL,
	"effective_until" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mth_range_valid" CHECK ("member_type_history"."effective_until" is null or "member_type_history"."effective_until" > "member_type_history"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "monthly_hour_fund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"fund_seconds" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_hour_fund_unq" UNIQUE("organization_id","year","month"),
	CONSTRAINT "monthly_hour_fund_month_valid" CHECK ("monthly_hour_fund"."month" >= 1 and "monthly_hour_fund"."month" <= 12),
	CONSTRAINT "monthly_hour_fund_seconds_valid" CHECK ("monthly_hour_fund"."fund_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "not_on_invoice_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"user_id" text NOT NULL,
	"status_option_id" uuid,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "not_on_invoice_entry_unq" UNIQUE("organization_id","year","month","user_id"),
	CONSTRAINT "not_on_invoice_entry_month_valid" CHECK ("not_on_invoice_entry"."month" >= 1 and "not_on_invoice_entry"."month" <= 12)
);
--> statement-breakpoint
CREATE TABLE "not_on_invoice_status_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"compliance_missing_days" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_settings_org_unq" UNIQUE("organization_id"),
	CONSTRAINT "org_settings_missing_days_valid" CHECK ("org_settings"."compliance_missing_days" >= 1 and "org_settings"."compliance_missing_days" <= 30)
);
--> statement-breakpoint
CREATE TABLE "member_slack_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_slack_identity_org_user_unq" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "slack_installation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text,
	"bot_token" text NOT NULL,
	"bot_user_id" text,
	"installed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_installation_org_unq" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "time_entry_type" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_time_off_allowance" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time_off_policy" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time_off_request" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "time_entry_type" CASCADE;--> statement-breakpoint
DROP TABLE "member_time_off_allowance" CASCADE;--> statement-breakpoint
DROP TABLE "time_off_policy" CASCADE;--> statement-breakpoint
DROP TABLE "time_off_request" CASCADE;--> statement-breakpoint
ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_client_id_client_id_fk";
--> statement-breakpoint
ALTER TABLE "recurring_block_rule" DROP CONSTRAINT IF EXISTS "recurring_block_rule_type_id_time_entry_type_id_fk";
--> statement-breakpoint
ALTER TABLE "recurring_block_rule" DROP CONSTRAINT IF EXISTS "recurring_block_rule_project_id_project_id_fk";
--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_project_id_project_id_fk";
--> statement-breakpoint
ALTER TABLE "time_entry" DROP CONSTRAINT IF EXISTS "time_entry_type_id_time_entry_type_id_fk";
--> statement-breakpoint
ALTER TABLE "time_entry" DROP CONSTRAINT IF EXISTS "time_entry_task_id_task_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "rbr_type_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "task_project_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "te_org_user_started_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "te_type_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "te_fill_day_uidx";--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "client_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_block_rule" ALTER COLUMN "description" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ALTER COLUMN "task_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "is_internal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "type" "project_type" DEFAULT 'product_team' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "hourly_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "role" "project_role" DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_block_rule" ADD COLUMN "task_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "scope" "task_scope" NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "is_absence" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "date" text NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "overtime" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "last_slack_nudge_day" text;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "last_month_end_push_day" text;--> statement-breakpoint
ALTER TABLE "monthly_close" ADD CONSTRAINT "monthly_close_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_close" ADD CONSTRAINT "monthly_close_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_close" ADD CONSTRAINT "monthly_close_submitted_by_user_id_user_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_close" ADD CONSTRAINT "monthly_close_finalized_by_user_id_user_id_fk" FOREIGN KEY ("finalized_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_close_row" ADD CONSTRAINT "monthly_close_row_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_close_row" ADD CONSTRAINT "monthly_close_row_close_id_monthly_close_id_fk" FOREIGN KEY ("close_id") REFERENCES "public"."monthly_close"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_close_row" ADD CONSTRAINT "monthly_close_row_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profile" ADD CONSTRAINT "member_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profile" ADD CONSTRAINT "member_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_type_history" ADD CONSTRAINT "member_type_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_type_history" ADD CONSTRAINT "member_type_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_hour_fund" ADD CONSTRAINT "monthly_hour_fund_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "not_on_invoice_entry" ADD CONSTRAINT "not_on_invoice_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "not_on_invoice_entry" ADD CONSTRAINT "not_on_invoice_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "not_on_invoice_entry" ADD CONSTRAINT "not_on_invoice_entry_status_option_id_not_on_invoice_status_option_id_fk" FOREIGN KEY ("status_option_id") REFERENCES "public"."not_on_invoice_status_option"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "not_on_invoice_status_option" ADD CONSTRAINT "not_on_invoice_status_option_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_slack_identity" ADD CONSTRAINT "member_slack_identity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_slack_identity" ADD CONSTRAINT "member_slack_identity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD CONSTRAINT "slack_installation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD CONSTRAINT "slack_installation_installed_by_user_id_user_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monthly_close_period_idx" ON "monthly_close" USING btree ("organization_id","year","month");--> statement-breakpoint
CREATE INDEX "monthly_close_row_user_idx" ON "monthly_close_row" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "project_task_org_idx" ON "project_task" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "mth_org_user_idx" ON "member_type_history" USING btree ("organization_id","user_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "mth_current_uidx" ON "member_type_history" USING btree ("organization_id","user_id") WHERE "member_type_history"."effective_until" is null;--> statement-breakpoint
CREATE INDEX "noiso_org_idx" ON "not_on_invoice_status_option" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "msi_org_idx" ON "member_slack_identity" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_block_rule" ADD CONSTRAINT "recurring_block_rule_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_block_rule" ADD CONSTRAINT "recurring_block_rule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_internal_uidx" ON "client" USING btree ("organization_id") WHERE "client"."is_internal" = true;--> statement-breakpoint
CREATE INDEX "project_member_user_idx" ON "project_member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "rbr_task_idx" ON "recurring_block_rule" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_site_name_uidx" ON "task" USING btree ("name") WHERE "task"."scope" = 'site' and "task"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "task_org_name_uidx" ON "task" USING btree ("organization_id","name") WHERE "task"."scope" = 'organization' and "task"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "te_org_user_date_idx" ON "time_entry" USING btree ("organization_id","user_id","date");--> statement-breakpoint
CREATE INDEX "te_org_date_idx" ON "time_entry" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "te_task_idx" ON "time_entry" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "te_fill_day_uidx" ON "time_entry" USING btree ("organization_id","user_id","date") WHERE "time_entry"."fills_day" = true;--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "billable";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "billable_rate";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "currency";--> statement-breakpoint
ALTER TABLE "project_member" DROP COLUMN "billable_rate";--> statement-breakpoint
ALTER TABLE "project_member" DROP COLUMN "cost_rate";--> statement-breakpoint
ALTER TABLE "project_member" DROP COLUMN "is_vacation_approver";--> statement-breakpoint
ALTER TABLE "recurring_block_rule" DROP COLUMN "type_id";--> statement-breakpoint
ALTER TABLE "recurring_block_rule" DROP COLUMN "start_time";--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN "billable";--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN "estimated_seconds";--> statement-breakpoint
ALTER TABLE "time_entry" DROP COLUMN "type_id";--> statement-breakpoint
ALTER TABLE "time_entry" DROP COLUMN "started_at";--> statement-breakpoint
ALTER TABLE "time_entry" DROP COLUMN "stopped_at";--> statement-breakpoint
ALTER TABLE "time_entry" DROP COLUMN "fill_date";--> statement-breakpoint
ALTER TABLE "time_entry" DROP COLUMN "billable";--> statement-breakpoint
ALTER TABLE "time_entry" DROP COLUMN "billable_rate_snapshot";--> statement-breakpoint
ALTER TABLE "notification_settings" DROP COLUMN "time_off_decisions";--> statement-breakpoint
ALTER TABLE "integration_settings" DROP COLUMN "google_sync_time_off";--> statement-breakpoint
ALTER TABLE "recurring_block_rule" ADD CONSTRAINT "rbr_duration_granularity" CHECK ("recurring_block_rule"."duration_seconds" > 0 and "recurring_block_rule"."duration_seconds" % 900 = 0);--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_org_scope_consistency" CHECK (
      ("task"."scope" = 'site' and "task"."organization_id" is null) or
      ("task"."scope" != 'site' and "task"."organization_id" is not null));--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_absence_is_site_scoped" CHECK ("task"."is_absence" = false or "task"."scope" = 'site');--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "te_duration_granularity" CHECK (("time_entry"."fills_day" = true and "time_entry"."duration_seconds" >= 0)
          or ("time_entry"."duration_seconds" > 0 and "time_entry"."duration_seconds" % 900 = 0));--> statement-breakpoint
DROP TYPE "public"."time_entry_type_scope";--> statement-breakpoint
DROP TYPE "public"."time_off_status";--> statement-breakpoint
DROP TYPE "public"."time_off_type";