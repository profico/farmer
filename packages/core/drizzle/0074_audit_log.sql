CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"actor_user_id" text,
	"actor_name" text,
	"impersonator_user_id" text,
	"impersonator_name" text,
	"via" text NOT NULL,
	"api_token_id" uuid,
	"ip" text,
	"user_agent" text,
	"target_type" text,
	"target_id" text,
	"target_label" text,
	"subject_user_id" text,
	"changes" jsonb,
	"details" jsonb,
	CONSTRAINT "audit_event_category_check" CHECK ("audit_event"."category" in ('change', 'security')),
	CONSTRAINT "audit_event_via_check" CHECK ("audit_event"."via" in ('web', 'api', 'api_token', 'cli', 'mcp', 'assistant', 'system'))
);
--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "audit_retention_days" smallint DEFAULT 365 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_org_time_idx" ON "audit_event" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_org_actor_idx" ON "audit_event" USING btree ("organization_id","actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_org_subject_idx" ON "audit_event" USING btree ("organization_id","subject_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_org_target_idx" ON "audit_event" USING btree ("organization_id","target_type","target_id");--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_audit_retention_valid" CHECK ("org_settings"."audit_retention_days" in (90, 365, 730, 2555));