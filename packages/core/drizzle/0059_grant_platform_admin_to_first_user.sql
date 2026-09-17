-- The instance's first account operates it.
--
-- New deployments get this from the bootstrap in `src/auth/index.ts`, which
-- runs when a user row is created. A deployment that already has users never
-- passes through that hook again, so the same rule is applied here once: the
-- oldest row, and only while nobody holds the role.
--
-- `created_at` alone is not a total order, so `id` breaks the tie — the same
-- ordering the bootstrap uses, so both answer with the same person.
UPDATE "user"
SET "role" = 'platform_admin'
WHERE "id" = (
	SELECT "id" FROM "user" ORDER BY "created_at" ASC, "id" ASC LIMIT 1
)
AND NOT EXISTS (
	SELECT 1 FROM "user" WHERE "role" = 'platform_admin'
);
