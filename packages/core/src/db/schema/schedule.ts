import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

export const timeOffStatus = pgEnum("time_off_status", [
	"pending",
	"approved",
	"denied",
]);

// The kind of time off. Only "vacation" is deducted from a member's allowance;
// the other types are recorded but don't consume the balance.
export const timeOffType = pgEnum("time_off_type", [
	"vacation",
	"sick",
	"personal",
	"unpaid",
	"other",
]);

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

// Per-member weekly target, used to compute over/under against logged time.
export const memberSchedule = pgTable(
	"member_schedule",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		weeklyTargetSeconds: integer("weekly_target_seconds").notNull().default(144000), // 40h
		...stamps,
	},
	(t) => [
		unique("member_schedule_org_user_unq").on(t.organizationId, t.userId),
	],
);

// Per-member, per-weekday working hours. dayOfWeek is 0=Sun..6=Sat, matching
// Date#getDay(), recurringBlockRule.daysOfWeek and weekdayInTz. A missing row
// implies a Mon-Fri 9-5 default (see workingHoursService.list) rather than
// requiring a backfill migration.
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
		unique("mwhd_org_user_day_unq").on(
			t.organizationId,
			t.userId,
			t.dayOfWeek,
		),
		check(
			"mwhd_day_of_week_valid",
			sql`${t.dayOfWeek} >= 0 and ${t.dayOfWeek} <= 6`,
		),
	],
);

// A member's PTO / time-off request, subject to admin approval.
export const timeOffRequest = pgTable(
	"time_off_request",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		startDate: text("start_date").notNull(), // yyyy-MM-dd
		endDate: text("end_date").notNull(), // yyyy-MM-dd
		type: timeOffType("type").notNull().default("vacation"),
		label: text("label"),
		// Optional reviewer the requester addressed the request to. Any eligible
		// approver may still act on it (see timeOffService.canDecide); this is a
		// hint, not a lock. Set null if that user's account is later removed.
		reviewerUserId: text("reviewer_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		status: timeOffStatus("status").notNull().default("pending"),
		decidedAt: ts("decided_at"),
		// set null (not cascade): a denied/approved request shouldn't break if
		// the deciding admin's account is later deleted.
		decidedByUserId: text("decided_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		decisionNote: text("decision_note"),
		// Id of the all-day event written to the requester's Google Calendar when
		// the request was approved and they had time-off sync enabled. Null when
		// sync was off, not connected, or the write failed (approval never blocks
		// on it). Kept so a future decline could delete the event.
		googleCalendarEventId: text("google_calendar_event_id"),
		...stamps,
	},
	(t) => [
		index("tor_org_user_start_idx").on(
			t.organizationId,
			t.userId,
			t.startDate,
		),
		index("tor_org_status_idx").on(t.organizationId, t.status),
	],
);

export const timeOffRequestRelations = relations(timeOffRequest, ({ one }) => ({
	user: one(user, {
		fields: [timeOffRequest.userId],
		references: [user.id],
		relationName: "timeOffRequester",
	}),
	decidedByUser: one(user, {
		fields: [timeOffRequest.decidedByUserId],
		references: [user.id],
		relationName: "timeOffDecider",
	}),
	reviewer: one(user, {
		fields: [timeOffRequest.reviewerUserId],
		references: [user.id],
		relationName: "timeOffReviewer",
	}),
}));

// Org-wide vacation policy. One row per org; a missing row implies the column
// defaults below (see timeOffPolicyService.getPolicy) so no backfill is needed.
export const timeOffPolicy = pgTable(
	"time_off_policy",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		// Days of vacation each member gets per calendar year, unless overridden
		// per member (see memberTimeOffAllowance).
		defaultAllowanceDays: integer("default_allowance_days")
			.notNull()
			.default(20),
		// Whether unused days roll into the next year.
		carryoverEnabled: boolean("carryover_enabled").notNull().default(true),
		// Cap on carried-over days (null = uncapped).
		carryoverMaxDays: integer("carryover_max_days"),
		// The date (month/day) in the next year on which unused carryover expires.
		carryoverExpiryMonth: integer("carryover_expiry_month").notNull().default(3),
		carryoverExpiryDay: integer("carryover_expiry_day").notNull().default(31),
		...stamps,
	},
	(t) => [
		unique("time_off_policy_org_unq").on(t.organizationId),
		check(
			"time_off_policy_expiry_month_valid",
			sql`${t.carryoverExpiryMonth} >= 1 and ${t.carryoverExpiryMonth} <= 12`,
		),
		check(
			"time_off_policy_expiry_day_valid",
			sql`${t.carryoverExpiryDay} >= 1 and ${t.carryoverExpiryDay} <= 31`,
		),
	],
);

// Per-member override of the org default allowance. Missing row ⇒ policy
// default applies (see timeOffPolicyService.getMemberAllowanceDays).
export const memberTimeOffAllowance = pgTable(
	"member_time_off_allowance",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		allowanceDays: integer("allowance_days"),
		...stamps,
	},
	(t) => [
		unique("member_time_off_allowance_org_user_unq").on(
			t.organizationId,
			t.userId,
		),
	],
);

// Holidays an org has opted out of. Keyed by the date-holidays holiday name,
// which is stable across years for a given country, so one row disables that
// holiday every year. Row present = disabled.
export const disabledHoliday = pgTable(
	"disabled_holiday",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		name: text("name").notNull(),
		...stamps,
	},
	(t) => [
		unique("disabled_holiday_org_name_unq").on(t.organizationId, t.name),
	],
);
