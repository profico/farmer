CREATE TYPE "public"."task_system_key" AS ENUM('meeting', 'development', 'break', 'vacation', 'sick');--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "system_key" "task_system_key";--> statement-breakpoint
-- Backfill: adopt the names the engines used to match on as the initial keys.
-- Deliberately narrow on scope and is_absence rather than matching name alone,
-- so an org-created task that merely happens to be called "Vacation" is not
-- mistaken for the site-wide absence built-in. Archived rows are keyed too --
-- both unique indexes below exclude them, so a pile of archived "Meeting"s is
-- harmless -- which keeps the key meaningful if one is ever unarchived.
UPDATE "task" SET "system_key" = CASE "name"
	WHEN 'Vacation' THEN 'vacation'
	WHEN 'Sick Leave' THEN 'sick'
END::"public"."task_system_key"
WHERE "scope" = 'site' AND "is_absence" = true
	AND "name" IN ('Vacation', 'Sick Leave');--> statement-breakpoint
UPDATE "task" SET "system_key" = CASE "name"
	WHEN 'Meeting' THEN 'meeting'
	WHEN 'Development' THEN 'development'
	WHEN 'Break' THEN 'break'
END::"public"."task_system_key"
WHERE "scope" = 'organization' AND "is_absence" = false
	AND "name" IN ('Meeting', 'Development', 'Break');--> statement-breakpoint
CREATE UNIQUE INDEX "task_org_system_key_uidx" ON "task" USING btree ("organization_id","system_key") WHERE "task"."scope" = 'organization' and "task"."system_key" is not null and "task"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "task_site_system_key_uidx" ON "task" USING btree ("system_key") WHERE "task"."scope" = 'site' and "task"."system_key" is not null and "task"."archived_at" is null;