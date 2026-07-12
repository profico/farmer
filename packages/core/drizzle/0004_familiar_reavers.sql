CREATE TYPE "public"."time_entry_type_scope" AS ENUM('site', 'organization', 'project');--> statement-breakpoint
CREATE TABLE "recurring_block_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type_id" uuid NOT NULL,
	"project_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"days_of_week" integer[] NOT NULL,
	"start_time" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"effective_from" text,
	"effective_until" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rbr_days_of_week_valid" CHECK ("recurring_block_rule"."days_of_week" <@ ARRAY[0,1,2,3,4,5,6]::integer[])
);
--> statement-breakpoint
CREATE TABLE "recurring_block_rule_skip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entry_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" time_entry_type_scope NOT NULL,
	"organization_id" text,
	"project_id" uuid,
	"name" text NOT NULL,
	"color" text,
	"billable_default" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tet_org_scope_consistency" CHECK (
      ("time_entry_type"."scope" = 'site' and "time_entry_type"."organization_id" is null) or
      ("time_entry_type"."scope" != 'site' and "time_entry_type"."organization_id" is not null)),
	CONSTRAINT "tet_project_scope_consistency" CHECK (
      ("time_entry_type"."scope" = 'project' and "time_entry_type"."project_id" is not null) or
      ("time_entry_type"."scope" != 'project' and "time_entry_type"."project_id" is null))
);
--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "type_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "generated_from_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "generated_for_date" text;--> statement-breakpoint
ALTER TABLE "recurring_block_rule" ADD CONSTRAINT "recurring_block_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_block_rule" ADD CONSTRAINT "recurring_block_rule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_block_rule" ADD CONSTRAINT "recurring_block_rule_type_id_time_entry_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."time_entry_type"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_block_rule" ADD CONSTRAINT "recurring_block_rule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_block_rule_skip" ADD CONSTRAINT "recurring_block_rule_skip_rule_id_recurring_block_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."recurring_block_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_type" ADD CONSTRAINT "time_entry_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_type" ADD CONSTRAINT "time_entry_type_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rbr_org_user_idx" ON "recurring_block_rule" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "rbr_type_idx" ON "recurring_block_rule" USING btree ("type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rbrs_rule_date_uidx" ON "recurring_block_rule_skip" USING btree ("rule_id","date");--> statement-breakpoint
CREATE INDEX "time_entry_type_org_idx" ON "time_entry_type" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "time_entry_type_project_idx" ON "time_entry_type" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tet_site_name_uidx" ON "time_entry_type" USING btree ("name") WHERE "time_entry_type"."scope" = 'site' and "time_entry_type"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tet_org_name_uidx" ON "time_entry_type" USING btree ("organization_id","name") WHERE "time_entry_type"."scope" = 'organization' and "time_entry_type"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tet_project_name_uidx" ON "time_entry_type" USING btree ("project_id","name") WHERE "time_entry_type"."scope" = 'project' and "time_entry_type"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_type_id_time_entry_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."time_entry_type"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_generated_from_rule_id_recurring_block_rule_id_fk" FOREIGN KEY ("generated_from_rule_id") REFERENCES "public"."recurring_block_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "te_type_idx" ON "time_entry" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "te_rule_idx" ON "time_entry" USING btree ("generated_from_rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "te_generated_once_uidx" ON "time_entry" USING btree ("generated_from_rule_id","generated_for_date") WHERE "time_entry"."generated_from_rule_id" is not null;