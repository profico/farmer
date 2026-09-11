-- Paid Leave: a third built-in absence task, with its own system key.
--
-- Not `ALTER TYPE ... ADD VALUE`. The migrator runs every pending migration in
-- ONE transaction, and Postgres refuses to use an enum value inside the
-- transaction that added it ("unsafe use of new value"). On a fresh database
-- (tests, CI, a new deploy) the INSERT below would fail even from a later file.
-- Rebuilding the type is legal in one transaction; task.system_key is the only
-- column that uses it.
ALTER TYPE "public"."task_system_key" RENAME TO "task_system_key_old";--> statement-breakpoint
CREATE TYPE "public"."task_system_key" AS ENUM('meeting', 'development', 'break', 'vacation', 'sick', 'paid_leave');--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "system_key" SET DATA TYPE "public"."task_system_key" USING "system_key"::text::"public"."task_system_key";--> statement-breakpoint
DROP TYPE "public"."task_system_key_old";--> statement-breakpoint
-- The shared row. Idempotent: an instance whose app already booted with the
-- updated seeder has it, and ON CONFLICT covers both site unique indexes.
INSERT INTO "task" ("scope", "name", "color", "is_absence", "system_key")
VALUES ('site', 'Paid Leave', 'teal', true, 'paid_leave')
ON CONFLICT DO NOTHING;
