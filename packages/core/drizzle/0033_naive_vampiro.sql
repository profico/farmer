-- A repo now belongs to exactly one project per organization. Any database that
-- already linked one repo to two projects would fail the ADD CONSTRAINT below,
-- so collapse those rows first rather than leaving the migration to bounce.
--
-- The winner is the OLDEST link (created_at, then id as a deterministic
-- tiebreak): the first project someone attached the repo to is the one the
-- commits have been filing against, so keeping it is the choice that changes
-- the fewest existing entries.

-- 1. Re-point attached commits from the losing links to the winner. Without
--    this the FK's ON DELETE SET NULL would blank them, and every affected
--    entry would silently lose its "jump to repo" affordance.
UPDATE "time_entry_github_commit" AS c
SET "project_github_repo_id" = w."id"
FROM "project_github_repo" AS loser
JOIN (
	SELECT DISTINCT ON ("organization_id", "github_repo_id")
		"id", "organization_id", "github_repo_id"
	FROM "project_github_repo"
	ORDER BY "organization_id", "github_repo_id", "created_at", "id"
) AS w
	ON w."organization_id" = loser."organization_id"
	AND w."github_repo_id" = loser."github_repo_id"
WHERE c."project_github_repo_id" = loser."id"
	AND loser."id" <> w."id";--> statement-breakpoint

-- 2. Drop the losing links.
DELETE FROM "project_github_repo" AS loser
USING (
	SELECT DISTINCT ON ("organization_id", "github_repo_id")
		"id", "organization_id", "github_repo_id"
	FROM "project_github_repo"
	ORDER BY "organization_id", "github_repo_id", "created_at", "id"
) AS w
WHERE loser."organization_id" = w."organization_id"
	AND loser."github_repo_id" = w."github_repo_id"
	AND loser."id" <> w."id";--> statement-breakpoint

ALTER TABLE "project_github_repo" DROP CONSTRAINT "pgr_project_repo_unq";--> statement-breakpoint
ALTER TABLE "project_github_repo" ADD CONSTRAINT "pgr_org_repo_unq" UNIQUE("organization_id","github_repo_id");
