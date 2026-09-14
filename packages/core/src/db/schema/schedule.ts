import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

// NOTE: the time-off *request* workflow (pending/approved/denied, reviewers,
// allowances, carryover policy) was deliberately removed. Vacation and Sick
// Leave are now self-logged time entries against the two built-in absence tasks
// (PRD 3.5): the person knows when they were sick, absence data accumulates in
// one system with everything else, and the company-wide absence report (6.3)
// falls out of the entry table for free. PMs can correct absence entries for
// people on their projects.

const ts = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" });
const org = () =>
	text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" });
const stamps = {
	createdAt: ts("created_at").notNull().defaultNow(),
	updatedAt: ts("updated_at").notNull().defaultNow(),
};

// Per-member, per-weekday working hours. dayOfWeek is 0=Sun..6=Sat, matching
// Date#getDay(), recurringBlockRule.daysOfWeek and weekdayInTz. A missing row
// implies a Mon-Fri 9-5 default (see workingHoursService.list) rather than
// requiring a backfill migration. UX plumbing for the fill block, time-off
// spans and the reminders' timing — not a target: the weekly target that used
// to sit beside it (member_schedule) went with the fund rule (Sept 2026).
export const memberWorkingHoursDay = pgTable(
	"member_working_hours_day",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		dayOfWeek: integer("day_of_week").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		startTime: text("start_time"), // "HH:mm", local to org tz
		endTime: text("end_time"), // "HH:mm", local to org tz
		...stamps,
	},
	(t) => [
		unique("mwhd_org_user_day_unq").on(t.organizationId, t.userId, t.dayOfWeek),
		check(
			"mwhd_day_of_week_valid",
			sql`${t.dayOfWeek} >= 0 and ${t.dayOfWeek} <= 6`,
		),
	],
);

// Holidays an org has opted out of. Keyed by the date-holidays holiday name,
// which is stable across years for a given country, so one row disables that
// holiday every year. Row present = disabled. Feeds the monthly-hour-fund
// prefill (PRD roadmap item 5) as well as the working-day calculations.
export const disabledHoliday = pgTable(
	"disabled_holiday",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		name: text("name").notNull(),
		...stamps,
	},
	(t) => [unique("disabled_holiday_org_name_unq").on(t.organizationId, t.name)],
);
