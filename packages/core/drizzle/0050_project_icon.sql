-- A project's icon (Sept 2026): an emoji shown wherever the project appears,
-- in place of the color swatch nobody could tell five of apart. The color
-- column goes with it: nothing else read it, and the Harvest import never set
-- it. Hand-written: a column added beside a column dropped reads as a rename
-- to drizzle-kit, which asks.
ALTER TABLE "project" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "color";
