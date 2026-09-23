-- A rule saved before the 24-hour ceiling existed may hold more than a day.
-- Clamp it to a whole day, so the new check can validate every row. 86400 is
-- a multiple of 900, so the clamped value still passes the granularity half.
UPDATE "recurring_block_rule" SET "duration_seconds" = 86400 WHERE "duration_seconds" > 86400;--> statement-breakpoint
ALTER TABLE "recurring_block_rule" DROP CONSTRAINT "rbr_duration_granularity";--> statement-breakpoint
ALTER TABLE "recurring_block_rule" ADD CONSTRAINT "rbr_duration_granularity" CHECK ("recurring_block_rule"."duration_seconds" > 0 and "recurring_block_rule"."duration_seconds" <= 86400 and "recurring_block_rule"."duration_seconds" % 900 = 0);