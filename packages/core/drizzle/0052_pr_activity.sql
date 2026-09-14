CREATE TABLE "time_entry_github_pr_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"project_github_repo_id" uuid,
	"event_id" text NOT NULL,
	"kind" text NOT NULL,
	"review_state" text,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"pull_request_url" text NOT NULL,
	"url" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tegpa_entry_event_unq" UNIQUE("time_entry_id","event_id"),
	CONSTRAINT "tegpa_kind_chk" CHECK ("time_entry_github_pr_activity"."kind" in ('opened', 'merged', 'closed', 'reviewed'))
);
--> statement-breakpoint
ALTER TABLE "time_entry_github_pr_activity" ADD CONSTRAINT "time_entry_github_pr_activity_time_entry_id_time_entry_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_github_pr_activity" ADD CONSTRAINT "time_entry_github_pr_activity_project_github_repo_id_project_github_repo_id_fk" FOREIGN KEY ("project_github_repo_id") REFERENCES "public"."project_github_repo"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tegpa_time_entry_idx" ON "time_entry_github_pr_activity" USING btree ("time_entry_id");