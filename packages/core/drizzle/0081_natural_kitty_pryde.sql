CREATE TABLE "slack_ping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"pinged_by_user_id" text,
	"pinged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_ping_org_user_unq" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "slack_ping" ADD CONSTRAINT "slack_ping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_ping" ADD CONSTRAINT "slack_ping_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_ping" ADD CONSTRAINT "slack_ping_pinged_by_user_id_user_id_fk" FOREIGN KEY ("pinged_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;