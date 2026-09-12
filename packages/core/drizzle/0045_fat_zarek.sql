-- Hand-edited from drizzle's output. Drizzle casts the old values straight onto
-- the new enum, which fails on any database that already has rows; the UPDATEs
-- below map billable → employee_billable, overhead → employee_overhead and
-- contractor → contractor_hourly while the columns are plain text.
ALTER TABLE "reminder_settings" DROP CONSTRAINT "reminder_settings_nudge_member_types_valid";--> statement-breakpoint
ALTER TABLE "reminder_settings" DROP CONSTRAINT "reminder_settings_month_end_member_types_valid";--> statement-breakpoint
ALTER TABLE "member_type_history" ALTER COLUMN "type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "member_type_history" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "reminder_settings" ALTER COLUMN "nudge_member_types" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "reminder_settings" ALTER COLUMN "nudge_member_types" SET DATA TYPE text[] USING "nudge_member_types"::text[];--> statement-breakpoint
ALTER TABLE "reminder_settings" ALTER COLUMN "month_end_member_types" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "reminder_settings" ALTER COLUMN "month_end_member_types" SET DATA TYPE text[] USING "month_end_member_types"::text[];--> statement-breakpoint
DROP TYPE "public"."member_type";--> statement-breakpoint
CREATE TYPE "public"."member_type" AS ENUM('employee_billable', 'employee_overhead', 'student_full_time', 'student_hourly', 'contractor_full_time', 'contractor_hourly');--> statement-breakpoint
UPDATE "member_type_history" SET "type" = CASE "type" WHEN 'billable' THEN 'employee_billable' WHEN 'overhead' THEN 'employee_overhead' WHEN 'contractor' THEN 'contractor_hourly' ELSE "type" END;--> statement-breakpoint
UPDATE "reminder_settings" SET
  "nudge_member_types" = array_replace(array_replace(array_replace("nudge_member_types", 'billable', 'employee_billable'), 'overhead', 'employee_overhead'), 'contractor', 'contractor_hourly'),
  "month_end_member_types" = array_replace(array_replace(array_replace("month_end_member_types", 'billable', 'employee_billable'), 'overhead', 'employee_overhead'), 'contractor', 'contractor_hourly');--> statement-breakpoint
ALTER TABLE "member_type_history" ALTER COLUMN "type" SET DATA TYPE "public"."member_type" USING "type"::"public"."member_type";--> statement-breakpoint
ALTER TABLE "member_type_history" ALTER COLUMN "type" SET DEFAULT 'employee_billable'::"public"."member_type";--> statement-breakpoint
ALTER TABLE "reminder_settings" ALTER COLUMN "nudge_member_types" SET DATA TYPE "public"."member_type"[] USING "nudge_member_types"::"public"."member_type"[];--> statement-breakpoint
ALTER TABLE "reminder_settings" ALTER COLUMN "nudge_member_types" SET DEFAULT '{"employee_billable","student_full_time","student_hourly","contractor_full_time","contractor_hourly"}'::"public"."member_type"[];--> statement-breakpoint
ALTER TABLE "reminder_settings" ALTER COLUMN "month_end_member_types" SET DATA TYPE "public"."member_type"[] USING "month_end_member_types"::"public"."member_type"[];--> statement-breakpoint
ALTER TABLE "reminder_settings" ALTER COLUMN "month_end_member_types" SET DEFAULT '{"employee_billable","student_full_time","student_hourly","contractor_full_time","contractor_hourly"}'::"public"."member_type"[];--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_nudge_member_types_valid" CHECK (cardinality("nudge_member_types") >= 1 and "nudge_member_types" <@ ARRAY['employee_billable','student_full_time','student_hourly','contractor_full_time','contractor_hourly']::member_type[]);--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_month_end_member_types_valid" CHECK (cardinality("month_end_member_types") >= 1 and "month_end_member_types" <@ ARRAY['employee_billable','student_full_time','student_hourly','contractor_full_time','contractor_hourly']::member_type[]);
