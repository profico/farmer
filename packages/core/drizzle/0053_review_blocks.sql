-- Review blocks: a system key for the task a reviewed pull request is filed
-- under, and the tombstone that keeps a deleted review block deleted.
--
-- The type is rebuilt rather than extended, for the reason 0038 gives: the
-- migrator runs every pending migration in ONE transaction, and the UPDATE
-- below may not use a value that `ALTER TYPE ... ADD VALUE` added inside it.
ALTER TYPE "public"."task_system_key" RENAME TO "task_system_key_old";--> statement-breakpoint
CREATE TYPE "public"."task_system_key" AS ENUM('meeting', 'development', 'break', 'vacation', 'sick', 'paid_leave', 'code_review');--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "system_key" SET DATA TYPE "public"."task_system_key" USING "system_key"::text::"public"."task_system_key";--> statement-breakpoint
DROP TYPE "public"."task_system_key_old";--> statement-breakpoint
-- The key goes on each org's live standard "Code Review" task, matched by name
-- this once because the key is what is being introduced. One row per org (the
-- name index is case-sensitive, so two spellings can both be live), and none
-- in an org that already has a live `code_review` task. An org that renamed
-- the task gets no key, and its reviews stay evidence on the day's work until
-- an admin names one. `ensureOrgTasks` seeds the key on every new org.
UPDATE "task" SET "system_key" = 'code_review', "updated_at" = now()
WHERE "id" IN (
	SELECT DISTINCT ON ("organization_id") "id" FROM "task"
	WHERE "scope" = 'organization'
		AND "archived_at" IS NULL
		AND "system_key" IS NULL
		AND lower("name") = 'code review'
	ORDER BY "organization_id", "created_at"
)
AND NOT EXISTS (
	SELECT 1 FROM "task" AS "keyed"
	WHERE "keyed"."organization_id" = "task"."organization_id"
		AND "keyed"."scope" = 'organization'
		AND "keyed"."system_key" = 'code_review'
		AND "keyed"."archived_at" IS NULL
);--> statement-breakpoint
CREATE TABLE "pull_request_review_tombstone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"pull_request_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prrt_org_user_date_pr_unq" UNIQUE("organization_id","user_id","date","pull_request_url")
);
--> statement-breakpoint
ALTER TABLE "pull_request_review_tombstone" ADD CONSTRAINT "pull_request_review_tombstone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_tombstone" ADD CONSTRAINT "pull_request_review_tombstone_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
