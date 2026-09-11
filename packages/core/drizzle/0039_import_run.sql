CREATE TYPE "public"."import_mapping_kind" AS ENUM('client', 'project', 'task', 'person', 'close');--> statement-breakpoint
CREATE TYPE "public"."import_run_status" AS ENUM('started', 'finished', 'undone');--> statement-breakpoint
CREATE TABLE "import_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" "import_mapping_kind" NOT NULL,
	"source_key" text NOT NULL,
	"local_id" text NOT NULL,
	"created" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_mapping_unq" UNIQUE("organization_id","kind","source_key")
);
--> statement-breakpoint
CREATE TABLE "import_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"created_by_user_id" text,
	"cutoff_date" text NOT NULL,
	"status" "import_run_status" DEFAULT 'started' NOT NULL,
	"entries_created" integer DEFAULT 0 NOT NULL,
	"entries_deleted" integer DEFAULT 0 NOT NULL,
	"closes_created" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "import_run_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "import_key" text;--> statement-breakpoint
ALTER TABLE "import_mapping" ADD CONSTRAINT "import_mapping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mapping" ADD CONSTRAINT "import_mapping_run_id_import_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_mapping_run_idx" ON "import_mapping" USING btree ("run_id") WHERE "import_mapping"."created" = true;--> statement-breakpoint
CREATE INDEX "import_run_org_idx" ON "import_run" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "te_import_key_uidx" ON "time_entry" USING btree ("organization_id","import_key") WHERE "time_entry"."import_key" is not null;--> statement-breakpoint
CREATE INDEX "te_import_run_idx" ON "time_entry" USING btree ("import_run_id") WHERE "time_entry"."import_run_id" is not null;