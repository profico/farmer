ALTER TABLE "commit_fill_tombstone" DROP CONSTRAINT "cft_org_user_date_unq";--> statement-breakpoint
ALTER TABLE "commit_fill_tombstone" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "commit_fill_tombstone" ADD CONSTRAINT "commit_fill_tombstone_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commit_fill_tombstone" ADD CONSTRAINT "cft_org_user_date_project_unq" UNIQUE NULLS NOT DISTINCT("organization_id","user_id","date","project_id");