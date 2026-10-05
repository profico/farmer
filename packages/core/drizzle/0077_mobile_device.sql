CREATE TYPE "public"."mobile_platform" AS ENUM('ios', 'android');--> statement-breakpoint
CREATE TABLE "mobile_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"platform" "mobile_platform" NOT NULL,
	"relay_id" text NOT NULL,
	"public_key" text NOT NULL,
	"app_version" text NOT NULL,
	"session_id" text NOT NULL,
	"live_activity_token" text,
	"notifications_allowed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_device_user_installation_unq" UNIQUE("user_id","installation_id")
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "reminders_channel" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "mobile_device" ADD CONSTRAINT "mobile_device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_device" ADD CONSTRAINT "mobile_device_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mobile_device_session_idx" ON "mobile_device" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "mobile_device_relay_idx" ON "mobile_device" USING btree ("relay_id");--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_reminders_channel_check" CHECK ("notification_settings"."reminders_channel" in ('app', 'slack'));