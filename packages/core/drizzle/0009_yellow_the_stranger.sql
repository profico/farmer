CREATE TABLE "project_github_repo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"github_repo_id" integer NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"private" boolean DEFAULT false NOT NULL,
	"linked_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pgr_project_repo_unq" UNIQUE("project_id","github_repo_id")
);
--> statement-breakpoint
CREATE TABLE "time_entry_github_commit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"project_github_repo_id" uuid,
	"sha" text NOT NULL,
	"message" text NOT NULL,
	"author_login" text,
	"committed_at" timestamp with time zone NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tegc_entry_sha_unq" UNIQUE("time_entry_id","sha")
);
--> statement-breakpoint
ALTER TABLE "project_github_repo" ADD CONSTRAINT "project_github_repo_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_github_repo" ADD CONSTRAINT "project_github_repo_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_github_repo" ADD CONSTRAINT "project_github_repo_linked_by_user_id_user_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_github_commit" ADD CONSTRAINT "time_entry_github_commit_time_entry_id_time_entry_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_github_commit" ADD CONSTRAINT "time_entry_github_commit_project_github_repo_id_project_github_repo_id_fk" FOREIGN KEY ("project_github_repo_id") REFERENCES "public"."project_github_repo"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pgr_org_idx" ON "project_github_repo" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pgr_project_idx" ON "project_github_repo" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tegc_time_entry_idx" ON "time_entry_github_commit" USING btree ("time_entry_id");