CREATE TABLE "commit_fill_tombstone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cft_org_user_date_unq" UNIQUE("organization_id","user_id","date")
);
--> statement-breakpoint
ALTER TABLE "commit_fill_tombstone" ADD CONSTRAINT "commit_fill_tombstone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commit_fill_tombstone" ADD CONSTRAINT "commit_fill_tombstone_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;