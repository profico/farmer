ALTER TABLE "recurring_block_rule" ADD COLUMN "active_since" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- The DEFAULT stamps every existing rule with the migration's own timestamp,
-- which would floor a rule made last week at today and leave the days between
-- unfilled. `created_at` is when the rule was actually switched on, so use it.
-- A rule that has been paused and resumed since then loses that nuance, which
-- errs toward filling a few extra days rather than skipping real ones.
UPDATE "recurring_block_rule" SET "active_since" = "created_at";
