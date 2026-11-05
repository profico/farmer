ALTER TABLE "project_member" ADD COLUMN "assigned_by_admin" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "member_profile" ADD COLUMN "claim_name" text;