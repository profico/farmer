CREATE TABLE "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"attempt" smallint DEFAULT 1 NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"attempted_at" timestamp with time zone,
	"status_code" integer,
	"error" text,
	"response_sample" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_delivery_attempt_unq" UNIQUE("endpoint_id","event_id","attempt")
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"secret" text NOT NULL,
	"previous_secret" text,
	"previous_secret_expires_at" timestamp with time zone,
	"enabled_events" text[] NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"last_success_at" timestamp with time zone,
	"failing_since" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoint_org_url_unq" UNIQUE("organization_id","url"),
	CONSTRAINT "webhook_endpoint_events_not_empty" CHECK (array_length("webhook_endpoint"."enabled_events", 1) >= 1)
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"endpoint_id" uuid,
	"data" jsonb,
	"data_dropped_at" timestamp with time zone,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fanned_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_endpoint_id_webhook_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_event_id_webhook_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."webhook_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_endpoint_id_webhook_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_delivery_due_idx" ON "webhook_delivery" USING btree ("next_attempt_at") WHERE "webhook_delivery"."attempted_at" is null and "webhook_delivery"."claimed_at" is null;--> statement-breakpoint
CREATE INDEX "webhook_delivery_endpoint_idx" ON "webhook_delivery" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_delivery_event_idx" ON "webhook_delivery" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_org_idx" ON "webhook_endpoint" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "webhook_event_pending_idx" ON "webhook_event" USING btree ("occurred_at") WHERE "webhook_event"."fanned_out_at" is null;--> statement-breakpoint
CREATE INDEX "webhook_event_org_idx" ON "webhook_event" USING btree ("organization_id","occurred_at");