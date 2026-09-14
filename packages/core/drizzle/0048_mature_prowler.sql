CREATE TABLE "team_lead_person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"lead_user_id" text NOT NULL,
	"person_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_lead_person_unq" UNIQUE("organization_id","lead_user_id","person_user_id"),
	CONSTRAINT "team_lead_person_not_self" CHECK ("team_lead_person"."lead_user_id" <> "team_lead_person"."person_user_id")
);
--> statement-breakpoint
ALTER TABLE "team_lead_person" ADD CONSTRAINT "team_lead_person_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_lead_person" ADD CONSTRAINT "team_lead_person_lead_user_id_user_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_lead_person" ADD CONSTRAINT "team_lead_person_person_user_id_user_id_fk" FOREIGN KEY ("person_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_lead_person_lead_idx" ON "team_lead_person" USING btree ("organization_id","lead_user_id");