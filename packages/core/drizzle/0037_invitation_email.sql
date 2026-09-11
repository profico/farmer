CREATE TYPE "public"."invitation_email_status" AS ENUM('sending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "invitation_email" (
	"invitation_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"status" "invitation_email_status" NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitation_email" ADD CONSTRAINT "invitation_email_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_email" ADD CONSTRAINT "invitation_email_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_email_org_idx" ON "invitation_email" USING btree ("organization_id");