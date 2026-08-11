CREATE TABLE "project_budget_alert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"threshold" integer NOT NULL,
	"notified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_budget_alert_unq" UNIQUE("project_id","threshold")
);
--> statement-breakpoint
ALTER TABLE "project_budget_alert" ADD CONSTRAINT "project_budget_alert_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budget_alert" ADD CONSTRAINT "project_budget_alert_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;