CREATE TABLE "org_github_installation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"installation_id" integer NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"connected_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ogi_org_installation_unq" UNIQUE("organization_id","installation_id")
);
--> statement-breakpoint
ALTER TABLE "project_github_repo" ADD COLUMN "installation_id" integer;--> statement-breakpoint
ALTER TABLE "org_github_installation" ADD CONSTRAINT "org_github_installation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_github_installation" ADD CONSTRAINT "org_github_installation_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ogi_org_idx" ON "org_github_installation" USING btree ("organization_id");