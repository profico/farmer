-- Promote Meeting and Break from per-org copies to shared site built-ins.
--
-- They are engine plumbing, not taxonomy: the calendar sync needs somewhere to
-- file imported meetings and the day assembler needs something to carve a break
-- out of, so both have to exist for every org. As org-scoped rows they were
-- seeded per org (when they were seeded at all) and could be archived out from
-- under the engine. Site scope makes them unarchivable and universal.
--
-- Development and Design stay org-scoped on purpose — those are vocabulary the
-- org curates and renames, and a site row is shared by every org on the
-- platform, so it cannot be renamed by any one of them.

-- 1. The shared rows. Idempotent: an instance whose app already booted with the
-- updated seeder has them, and ON CONFLICT covers both the site-name and the
-- site-system-key unique indexes.
INSERT INTO "task" ("scope", "name", "color", "is_absence", "system_key")
VALUES
	('site', 'Meeting', 'purple', false, 'meeting'),
	('site', 'Break', 'orange', false, 'break')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 2. Fold each org's live copy into the shared row. time_entry and
-- recurring_block_rule are ON DELETE RESTRICT, so every reference has to move
-- before step 3 can drop the copies.
--
-- Scoped to live copies (archived_at IS NULL) deliberately. An org that archived
-- its old "Meeting" has history parked on a dead row; repointing that history
-- onto the live shared task would quietly resurrect it into current reports.
-- Archived copies keep their system_key, which is harmless: both unique indexes
-- and tasksService.findBySystemKey exclude archived rows.
UPDATE "time_entry" te
SET "task_id" = site."id"
FROM "task" org_copy
JOIN "task" site
	ON site."scope" = 'site'
	AND site."archived_at" IS NULL
	AND site."system_key" = org_copy."system_key"
WHERE te."task_id" = org_copy."id"
	AND org_copy."scope" = 'organization'
	AND org_copy."archived_at" IS NULL
	AND org_copy."system_key" IN ('meeting', 'break');--> statement-breakpoint

UPDATE "recurring_block_rule" rbr
SET "task_id" = site."id"
FROM "task" org_copy
JOIN "task" site
	ON site."scope" = 'site'
	AND site."archived_at" IS NULL
	AND site."system_key" = org_copy."system_key"
WHERE rbr."task_id" = org_copy."id"
	AND org_copy."scope" = 'organization'
	AND org_copy."archived_at" IS NULL
	AND org_copy."system_key" IN ('meeting', 'break');--> statement-breakpoint

-- project_task carries a unique (project_id, task_id). If a project somehow
-- already picked the shared row, repointing its org copy would collide — so drop
-- the redundant link first, then move what's left.
DELETE FROM "project_task" pt
USING "task" org_copy, "task" site
WHERE pt."task_id" = org_copy."id"
	AND org_copy."scope" = 'organization'
	AND org_copy."archived_at" IS NULL
	AND org_copy."system_key" IN ('meeting', 'break')
	AND site."scope" = 'site'
	AND site."archived_at" IS NULL
	AND site."system_key" = org_copy."system_key"
	AND EXISTS (
		SELECT 1 FROM "project_task" other
		WHERE other."project_id" = pt."project_id"
			AND other."task_id" = site."id"
	);--> statement-breakpoint

UPDATE "project_task" pt
SET "task_id" = site."id"
FROM "task" org_copy
JOIN "task" site
	ON site."scope" = 'site'
	AND site."archived_at" IS NULL
	AND site."system_key" = org_copy."system_key"
WHERE pt."task_id" = org_copy."id"
	AND org_copy."scope" = 'organization'
	AND org_copy."archived_at" IS NULL
	AND org_copy."system_key" IN ('meeting', 'break');--> statement-breakpoint

-- 3. Drop the now-unreferenced copies. If step 2 failed to find a shared row to
-- fold into, the RESTRICT foreign keys make this fail loudly rather than
-- half-applying.
DELETE FROM "task"
WHERE "scope" = 'organization'
	AND "archived_at" IS NULL
	AND "system_key" IN ('meeting', 'break');
