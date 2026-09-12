CREATE TYPE "public"."task_group" AS ENUM('engineering', 'product', 'learning', 'general', 'time_off');--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "group" "task_group" DEFAULT 'general' NOT NULL;--> statement-breakpoint
-- Hand-written data migration. Renames and merges each org's Harvest-era task
-- names into the standard taxonomy (packages/core/src/lib/task-taxonomy.ts) and
-- assigns every task its group. Where the target task already exists, the old
-- task's entries, recurring rules, project picks, filing rules and import
-- mappings move to it and the old task is deleted; otherwise the old task is
-- renamed. Nothing is lost: every time entry keeps a task.
DO $$
DECLARE
  o record;
  a record;
  old_id uuid;
  tgt_id uuid;
  old_live boolean;
BEGIN
  CREATE TEMP TABLE tt_alias (old_key text, new_name text) ON COMMIT DROP;
  INSERT INTO tt_alias VALUES
    ('frontend lead', 'Frontend'),
    ('ios mobile', 'iOS'),
    ('appletv', 'iOS'),
    ('android mobile', 'Android'),
    ('dev (web)', 'Development'),
    ('architecture', 'Development'),
    ('server setup', 'Development'),
    ('setup', 'Development'),
    ('forum', 'Development'),
    ('code review and instructions', 'Code Review'),
    ('support & maintenance', 'Support'),
    ('monitoring', 'Support'),
    ('ui/ux design', 'Design'),
    ('ux design', 'Design'),
    ('ui design', 'Design'),
    ('framer', 'Design'),
    ('wireframing', 'Design'),
    ('wireframing & content', 'Design'),
    ('social design', 'Design'),
    ('testing', 'QA'),
    ('qa & testing', 'QA'),
    ('planning', 'Project management'),
    ('organisation', 'Project management'),
    ('reporting', 'Project management'),
    ('product owner', 'Project management'),
    ('product strategy', 'Project management'),
    ('analytics', 'Data Analytics'),
    ('data & analytics', 'Data Analytics'),
    ('internship management', 'Mentoring'),
    ('sales', 'Marketing'),
    ('web content', 'Marketing'),
    ('extras', 'Other'),
    ('janitorial services', 'Other'),
    ('janitor work', 'Other');
  CREATE TEMP TABLE tt_std (name text, grp text) ON COMMIT DROP;
  INSERT INTO tt_std VALUES
    ('Frontend', 'engineering'),
    ('Backend', 'engineering'),
    ('iOS', 'engineering'),
    ('Android', 'engineering'),
    ('KMP', 'engineering'),
    ('Development', 'engineering'),
    ('WordPress', 'engineering'),
    ('Bugfixing', 'engineering'),
    ('Code Review', 'engineering'),
    ('Support', 'engineering'),
    ('Maintenance', 'engineering'),
    ('Research', 'engineering'),
    ('Design', 'product'),
    ('QA', 'product'),
    ('Project management', 'product'),
    ('Data Analytics', 'product'),
    ('Education', 'learning'),
    ('Mentoring', 'learning'),
    ('Workshop', 'learning'),
    ('Marketing', 'general'),
    ('Travel', 'general'),
    ('Other', 'general');

  FOR o IN SELECT id FROM organization LOOP
    FOR a IN SELECT old_key, new_name FROM tt_alias
             UNION ALL SELECT lower(name), name FROM tt_std LOOP
      SELECT id, archived_at IS NULL INTO old_id, old_live FROM task
        WHERE organization_id = o.id AND scope = 'organization'
          AND lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) = a.old_key
          AND name <> a.new_name
        ORDER BY (archived_at IS NULL) DESC, created_at LIMIT 1;
      IF old_id IS NULL THEN CONTINUE; END IF;
      SELECT id INTO tgt_id FROM task
        WHERE organization_id = o.id AND scope = 'organization' AND id <> old_id
          AND lower(btrim(name)) = lower(a.new_name)
        ORDER BY (archived_at IS NULL) DESC, created_at LIMIT 1;
      IF tgt_id IS NULL THEN
        UPDATE task SET name = a.new_name, updated_at = now() WHERE id = old_id;
      ELSE
        IF old_live THEN UPDATE task SET archived_at = NULL WHERE id = tgt_id; END IF;
        UPDATE time_entry SET task_id = tgt_id WHERE task_id = old_id;
        UPDATE recurring_block_rule SET task_id = tgt_id WHERE task_id = old_id;
        UPDATE project_task pt SET task_id = tgt_id WHERE task_id = old_id
          AND NOT EXISTS (SELECT 1 FROM project_task x WHERE x.project_id = pt.project_id AND x.task_id = tgt_id);
        DELETE FROM project_task WHERE task_id = old_id;
        UPDATE filing_rule fr SET task_id = tgt_id WHERE task_id = old_id
          AND NOT EXISTS (SELECT 1 FROM filing_rule x WHERE x.organization_id = fr.organization_id
            AND x.user_id = fr.user_id AND x.task_id = tgt_id AND x.title_key = fr.title_key);
        DELETE FROM filing_rule WHERE task_id = old_id;
        UPDATE import_mapping SET local_id = tgt_id::text WHERE kind = 'task' AND local_id = old_id::text;
        DELETE FROM task WHERE id = old_id;
      END IF;
    END LOOP;
    UPDATE task t SET "group" = s.grp::task_group FROM tt_std s
      WHERE t.organization_id = o.id AND t.scope = 'organization' AND lower(btrim(t.name)) = lower(s.name);
  END LOOP;
  UPDATE task SET "group" = 'time_off' WHERE scope = 'site' AND is_absence;
  UPDATE task SET "group" = 'general' WHERE scope = 'site' AND NOT is_absence;
END $$;
