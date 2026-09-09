-- Stop `member_type_history` from holding two segments that cover the same day.
--
-- The service has always documented the invariant ("at most one open-ended row
-- per person, previous row closed in the same transaction") and `typesAsOf`
-- relied on it to answer with a plain Map build. Nothing enforced it, and
-- `setType` could break it by itself: backdating a type shared a branch with
-- the no-op edit and rewrote the current row's `effective_from` without
-- touching the segment it was reaching back over, so the months between were
-- covered twice. `typesAsOf` then resolved them by plan order, which made
-- Expected, utilization and the compliance pace check disagree about a past
-- month on unchanged data.
--
-- `setType` is fixed in the same change. This migration heals the rows that
-- fix cannot reach and puts the invariant somewhere it cannot be forgotten.
--
-- A trigger rather than the obvious `EXCLUDE USING gist (... daterange ...)`:
-- that needs `btree_gist`, and the test harness runs these same migrations
-- under PGLite, which does not ship it. An exclusion constraint would have
-- meant production and the suite enforcing different schemas — and the suite is
-- the only place this ever gets exercised. A trigger is weaker under true
-- concurrency (two transactions can pass the check and both commit), which is
-- an acceptable trade here: writes go through one admin-only path and
-- `mth_current_uidx` still blocks the two-open-rows case outright.

--> statement-breakpoint
-- 1. Two segments starting on the same day always overlap, and no truncation
-- can separate them. Keep the newest; it is the one the last edit meant.
DELETE FROM "member_type_history" a
USING "member_type_history" b
WHERE a."organization_id" = b."organization_id"
	AND a."user_id" = b."user_id"
	AND a."effective_from" = b."effective_from"
	AND (a."created_at", a."id") < (b."created_at", b."id");--> statement-breakpoint

-- 2. Close every remaining segment at the next one's start. Segments that
-- already end there (the ordinary case) are left alone by the WHERE.
WITH "next_start" AS (
	SELECT
		"id",
		lead("effective_from") OVER (
			PARTITION BY "organization_id", "user_id"
			ORDER BY "effective_from"
		) AS "next_from"
	FROM "member_type_history"
)
UPDATE "member_type_history" m
SET "effective_until" = n."next_from", "updated_at" = now()
FROM "next_start" n
WHERE m."id" = n."id"
	AND n."next_from" IS NOT NULL
	AND (m."effective_until" IS NULL OR m."effective_until" > n."next_from");--> statement-breakpoint

-- 3. The guard. Text comparison, not `daterange`: the columns are yyyy-MM-dd
-- strings, which sort correctly as text, so this needs no cast and cannot fail
-- on a row that somehow holds an unparseable date.
CREATE OR REPLACE FUNCTION "mth_assert_no_overlap"() RETURNS trigger AS $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "member_type_history" o
		WHERE o."id" <> NEW."id"
			AND o."organization_id" = NEW."organization_id"
			AND o."user_id" = NEW."user_id"
			AND (o."effective_until" IS NULL OR o."effective_until" > NEW."effective_from")
			AND (NEW."effective_until" IS NULL OR NEW."effective_until" > o."effective_from")
	) THEN
		RAISE EXCEPTION
			'member_type_history: segment for user % from % overlaps an existing one',
			NEW."user_id", NEW."effective_from"
			USING ERRCODE = 'exclusion_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS "mth_no_overlap" ON "member_type_history";--> statement-breakpoint

CREATE TRIGGER "mth_no_overlap"
BEFORE INSERT OR UPDATE ON "member_type_history"
FOR EACH ROW EXECUTE FUNCTION "mth_assert_no_overlap"();
