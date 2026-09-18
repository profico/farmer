import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { importRun } from "./import";

export const projectStatus = pgEnum("project_status", ["active", "archived"]);

// Maps 1:1 to how the company invoices (PRD 3.3). Only `product_team` activates
// Expected-hours logic; every other type has none. `internal` is the "never billed" type — it is also the ONLY thing
// that makes an hour non-billable, since no per-entry billable flag exists.
export const projectType = pgEnum("project_type", [
	"product_team",
	"fixed_scope",
	"hourly",
	"maintenance",
	"internal",
]);

// Per-assignment, NOT per-person: the same person is PM on one project and a
// plain member on another (PRD 3.4). The only global role is org admin, which
// lives on better-auth's `member.role`.
export const projectRole = pgEnum("project_role", [
	"member",
	"team_lead",
	"pm",
]);

// Site-scoped tasks are platform built-ins (Vacation / Sick Leave), seeded and
// not creatable through the app. Organization-scoped are admin-created. There is
// deliberately NO project scope: the taxonomy is strictly global and every
// project offers every live task (PRD 3.5, revised Sept 2026).
export const taskScope = pgEnum("task_scope", ["site", "organization"]);

// The stable identity of a task the engines bind to, independent of its display
// name and its scope. Three engines need to find a specific task — the calendar
// sync files meetings, the day assembler proposes work and carves breaks — and
// they used to do it by matching `name` against a string literal, which meant
// renaming "Meeting" in Settings silently switched calendar sync off. The key is
// what they resolve now; the name stays freely editable.
//
// `code_review` is what the commit engine files a reviewed pull request under
// (see `services/pr-reviews.ts`). Org-scoped like `development`, so an org
// without it — renamed before the key existed, or archived — simply gets no
// review blocks and its reviews stay evidence on the day's work.
export const taskSystemKey = pgEnum("task_system_key", [
	"meeting",
	"development",
	"break",
	"vacation",
	"sick",
	"paid_leave",
	"code_review",
]);
export type TaskSystemKey = (typeof taskSystemKey.enumValues)[number];

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

export const client = pgTable(
	"client",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		name: text("name").notNull(),
		// The org's own "internal work" client (PRD calls it "Profico"). Auto-created
		// with the org so `project.clientId` can be NOT NULL without a nullable-client
		// special case, and so internal work is trivially filterable.
		isInternal: boolean("is_internal").notNull().default(false),
		archivedAt: ts("archived_at"),
		...stamps,
	},
	(t) => [
		index("client_org_idx").on(t.organizationId),
		// Exactly one internal client per org.
		uniqueIndex("client_internal_uidx")
			.on(t.organizationId)
			.where(sql`${t.isInternal} = true`),
	],
);

export const project = pgTable(
	"project",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		// Required (PRD 3.3): every project belongs to a client, internal work goes
		// to the org's internal client. `restrict` so archiving is the only way to
		// retire a client that still has history.
		clientId: uuid("client_id")
			.notNull()
			.references(() => client.id, { onDelete: "restrict" }),
		name: text("name").notNull(),
		code: text("code"),
		type: projectType("type").notNull().default("product_team"),
		status: projectStatus("status").notNull().default("active"),
		// An emoji shown wherever the project appears — the list, its page, the
		// picker, the timesheet. Replaced the color swatch (Sept 2026), which
		// five projects in a list made indistinguishable. Null: the first letter
		// of the name stands in.
		icon: text("icon"),
		// Everyone in the organization may log time here without an assignment —
		// the org's "Internal" project, which a new hire should not have to be
		// added to by hand. It grants Member rank only (`Access.canTrackOn`);
		// Team Lead and PM stay explicit assignments.
		openToOrg: boolean("open_to_org").notNull().default(false),
		// Fixed Scope hour budget — the ONLY budget that is ever computed against
		// (burn %, 80/100% alerts). Optional.
		budgetSeconds: integer("budget_seconds"),
		// The two money fields the PRD permits, both optional and both DISPLAY-ONLY:
		// a Fixed Scope EUR budget shown as context beside the hour figures, and an
		// Hourly project's price. Nothing in this system ever calculates on them —
		// there are no rates, no cost data, and no margins by design (PRD §11.5).
		budgetAmount: numeric("budget_amount", { precision: 12, scale: 2 }),
		hourlyPrice: numeric("hourly_price", { precision: 12, scale: 2 }),
		...stamps,
	},
	(t) => [
		index("project_org_idx").on(t.organizationId),
		index("project_client_idx").on(t.clientId),
	],
);

// The groups the Tasks page and the task picker show the list under. The list
// itself and the group of each standard task live in `lib/task-taxonomy.ts`.
export const taskGroup = pgEnum("task_group", [
	"engineering",
	"product",
	"learning",
	"general",
	"time_off",
]);

// The global task taxonomy (PRD 3.5). One list per org (plus site-wide built-ins),
// managed by admins in Settings. Every time entry requires one, which is enforced
// by `timeEntry.taskId` being NOT NULL rather than by application code.
export const task = pgTable(
	"task",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		scope: taskScope("scope").notNull(),
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "cascade",
		}),
		name: text("name").notNull(),
		// Which of the four picker groups the task sits in; absence tasks are the
		// fifth, time_off. Set by the seeders and the admin, read by the picker.
		group: taskGroup("group").notNull().default("general"),
		color: text("color"),
		description: text("description"),
		// Null for ordinary admin-created tasks. Set on the ones an engine needs to
		// locate (see `taskSystemKey`). Never exposed as an editable field — it is
		// assigned by the seeders and only read.
		systemKey: taskSystemKey("system_key"),
		// Vacation, Sick Leave and Paid Leave. Absence tasks are special-cased everywhere: they
		// carry no project, are not cherry-pickable onto projects, cannot be
		// archived, and feed the absence-day count behind Expected and report 6.3.
		isAbsence: boolean("is_absence").notNull().default(false),
		archivedAt: ts("archived_at"),
		...stamps,
	},
	(t) => [
		index("task_org_idx").on(t.organizationId),
		check(
			"task_org_scope_consistency",
			sql`
      (${t.scope} = 'site' and ${t.organizationId} is null) or
      (${t.scope} != 'site' and ${t.organizationId} is not null)`,
		),
		// Absence tasks only ever exist as site-scoped built-ins.
		check(
			"task_absence_is_site_scoped",
			sql`${t.isAbsence} = false or ${t.scope} = 'site'`,
		),
		uniqueIndex("task_site_name_uidx")
			.on(t.name)
			.where(sql`${t.scope} = 'site' and ${t.archivedAt} is null`),
		uniqueIndex("task_org_name_uidx")
			.on(t.organizationId, t.name)
			.where(sql`${t.scope} = 'organization' and ${t.archivedAt} is null`),
		// One live task per system key: once per org for org-scoped ones, once
		// platform-wide for site-scoped ones. Two indexes rather than one because a
		// site task's organization_id is NULL and Postgres treats NULLs as distinct
		// in a unique index — a single (organization_id, system_key) index would
		// happily allow unlimited site rows claiming the same key.
		uniqueIndex("task_org_system_key_uidx")
			.on(t.organizationId, t.systemKey)
			.where(
				sql`${t.scope} = 'organization' and ${t.systemKey} is not null and ${t.archivedAt} is null`,
			),
		uniqueIndex("task_site_system_key_uidx")
			.on(t.systemKey)
			.where(
				sql`${t.scope} = 'site' and ${t.systemKey} is not null and ${t.archivedAt} is null`,
			),
	],
);

// The join between Person and Project (PRD 3.4). Three things hang off it:
// tracking scope (you can only log time on projects you're assigned to), the
// per-project role. No date ranges in v1.
export const projectMember = pgTable(
	"project_member",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: projectRole("role").notNull().default("member"),
		active: boolean("active").notNull().default(true),
		...stamps,
	},
	(t) => [
		unique("project_member_unq").on(t.projectId, t.userId),
		index("project_member_user_idx").on(t.organizationId, t.userId),
	],
);

// A per-user recurring default block (e.g. a daily stand-up) materialized into
// real time_entry rows on read (see time-entries.service). Duration-only: the
// entry model carries no time of day, so a rule is "N seconds of task T on these
// weekdays", not a clock slot.
export const recurringBlockRule = pgTable(
	"recurring_block_rule",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		taskId: uuid("task_id")
			.notNull()
			.references(() => task.id, { onDelete: "restrict" }),
		projectId: uuid("project_id").references(() => project.id, {
			onDelete: "cascade",
		}),
		description: text("description").notNull(),
		daysOfWeek: integer("days_of_week").array().notNull(), // 0=Sun..6=Sat, matches Date#getDay()
		durationSeconds: integer("duration_seconds").notNull(),
		effectiveFrom: text("effective_from"), // yyyy-MM-dd, null = unbounded start
		effectiveUntil: text("effective_until"), // yyyy-MM-dd, null = ongoing
		active: boolean("active").notNull().default(true),
		// When this rule last became active — set at creation and re-set every time
		// the switch goes off->on, and the earliest day it may write to.
		//
		// `effective_from` cannot answer this. It is the schedule the rule keeps,
		// not the moment someone asked for it, and it is null on every rule the UI
		// creates — so without this the materializer reached back to the beginning
		// of time, and switching a paused rule back on refilled every day it had
		// been off for. Turning something on is a statement about tomorrow.
		activeSince: ts("active_since").notNull().defaultNow(),
		...stamps,
	},
	(t) => [
		index("rbr_org_user_idx").on(t.organizationId, t.userId),
		index("rbr_task_idx").on(t.taskId),
		check(
			"rbr_days_of_week_valid",
			sql`${t.daysOfWeek} <@ ARRAY[0,1,2,3,4,5,6]::integer[]`,
		),
		check(
			"rbr_duration_granularity",
			sql`${t.durationSeconds} > 0 and ${t.durationSeconds} % 900 = 0`,
		),
	],
);

// Marks a (rule, date) pair as intentionally skipped so a deleted generated
// entry doesn't silently reappear the next time the range is materialized.
export const recurringBlockRuleSkip = pgTable(
	"recurring_block_rule_skip",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		ruleId: uuid("rule_id")
			.notNull()
			.references(() => recurringBlockRule.id, { onDelete: "cascade" }),
		date: text("date").notNull(), // yyyy-MM-dd
		createdAt: ts("created_at").notNull().defaultNow(),
	},
	(t) => [uniqueIndex("rbrs_rule_date_uidx").on(t.ruleId, t.date)],
);

// Duration-only by design (PRD 3.6): a date and an amount of time, and no
// per-entry billable flag — billability is derived from
// `project.type != 'internal'`. An entry holds no clock and no start/stop: the
// stopwatch in `db/schema/timer.ts` is an input method that ends in one of
// these rows, snapped to the 15-minute step, and nothing else writes here.
export const timeEntry = pgTable(
	"time_entry",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// yyyy-MM-dd resolved in the org timezone. A real column (not derived from a
		// timestamp) so month/week grouping is a plain string comparison and no
		// timezone math leaks into reporting queries.
		date: text("date").notNull(),
		// Null for Vacation / Sick Leave, which carry no client and no project.
		projectId: uuid("project_id").references(() => project.id, {
			onDelete: "restrict",
		}),
		// Required on every entry — one half of the answer to "descriptions vary
		// wildly"; the mandatory description is the other half.
		taskId: uuid("task_id")
			.notNull()
			.references(() => task.id, { onDelete: "restrict" }),
		description: text("description").notNull().default(""),
		durationSeconds: integer("duration_seconds").notNull(),
		// Purely manual (PRD 3.6): no weekend automation, no rules. Overtime is part
		// of the total hours; the flag exists so it can be reported separately.
		overtime: boolean("overtime").notNull().default(false),
		// A "work time" block whose duration is not entered by hand but auto-set to
		// the rest of the day's target working hours minus every other entry that
		// day (see timeEntriesService.recomputeDayFill). At most one per user/day.
		fillsDay: boolean("fills_day").notNull().default(false),
		// Optional Google Calendar meeting attached to this entry: the join link and
		// the source event id (kept so the same event isn't imported twice).
		meetingUrl: text("meeting_url"),
		calendarEventId: text("calendar_event_id"),
		// True once the user takes ownership of a calendar-linked entry: filing
		// it, editing it, typing into its week cell. It marks the ROW as the
		// person's; which of its fields still follow the calendar is decided per
		// field by the three `synced*` columns below, so filing a meeting no
		// longer stops it moving when the calendar moves it (issue #60).
		syncLocked: boolean("sync_locked").notNull().default(false),
		// What the calendar last said this meeting's day, length and title were.
		// The meeting engine compares each field against its baseline: a field that
		// still equals what the calendar last said follows the calendar's new
		// value; one the person has changed is theirs and is left alone. Null when
		// nothing is known — a row the person made by hand around an event, or a
		// row filed before these columns existed — and a null baseline never
		// matches, so such a row keeps every value that differs from the calendar.
		syncedDate: text("synced_date"),
		syncedDurationSeconds: integer("synced_duration_seconds"),
		syncedDescription: text("synced_description"),
		// When the meeting starts, as the calendar has it. Display only — the
		// entry itself is duration-only by design (PRD 3.6) — so a person can tell
		// "the 10:00 stand-up" from "the 16:00 one" in the filing list. Always the
		// calendar's, rewritten on every sync; null on anything not a meeting.
		meetingStartsAt: ts("meeting_starts_at"),
		// The last time the sync changed this entry's day, length or title on the
		// calendar's say-so, and what those were before — so the row can say
		// "updated by calendar: moved from Thu, was 1:00" rather than moving in
		// silence. Set only when something actually changed on an existing row,
		// cleared when the person dismisses the notice (`acknowledgeCalendarChange`)
		// or the entry is unlinked. Never set by the first import.
		calendarChangedAt: ts("calendar_changed_at"),
		calendarChangeFrom: jsonb("calendar_change_from").$type<{
			date: string;
			durationSeconds: number;
			description: string;
		}>(),
		// Set together when this entry was auto-materialized from a recurring rule.
		generatedFromRuleId: uuid("generated_from_rule_id").references(
			() => recurringBlockRule.id,
			{ onDelete: "set null" },
		),
		generatedForDate: text("generated_for_date"), // yyyy-MM-dd, idempotency key
		// Set together on a row an import wrote (see schema/import.ts). The key is
		// a hash of the source row plus its position among identical rows of that
		// person-day, so a second import of the same file finds every row again.
		// Null on everything a person or an engine made here.
		importRunId: uuid("import_run_id").references(() => importRun.id, {
			onDelete: "set null",
		}),
		importKey: text("import_key"),
		...stamps,
	},
	(t) => [
		index("te_org_user_date_idx").on(t.organizationId, t.userId, t.date),
		index("te_org_date_idx").on(t.organizationId, t.date),
		index("te_project_idx").on(t.projectId),
		index("te_task_idx").on(t.taskId),
		index("te_rule_idx").on(t.generatedFromRuleId),
		// 15-minute granularity (PRD 3.6). Exempt for fill blocks: their duration is
		// computed from the day's remaining working hours, not entered, so it can
		// legitimately land off-grid (and may be 0 on an already-full day).
		check(
			"te_duration_granularity",
			sql`(${t.fillsDay} = true and ${t.durationSeconds} >= 0)
          or (${t.durationSeconds} > 0 and ${t.durationSeconds} % 900 = 0)`,
		),
		uniqueIndex("te_generated_once_uidx")
			.on(t.generatedFromRuleId, t.generatedForDate)
			.where(sql`${t.generatedFromRuleId} is not null`),
		uniqueIndex("te_calendar_event_uidx")
			.on(t.organizationId, t.userId, t.calendarEventId)
			.where(sql`${t.calendarEventId} is not null`),
		// At most one fill block per user/day, enforced in the DB. Now keyed on the
		// real `date` column — the old separate `fill_date` column existed only
		// because the entry's day used to be derived from a timestamp.
		uniqueIndex("te_fill_day_uidx")
			.on(t.organizationId, t.userId, t.date)
			.where(sql`${t.fillsDay} = true`),
		uniqueIndex("te_import_key_uidx")
			.on(t.organizationId, t.importKey)
			.where(sql`${t.importKey} is not null`),
		index("te_import_run_idx")
			.on(t.importRunId)
			.where(sql`${t.importRunId} is not null`),
	],
);

export const clientRelations = relations(client, ({ many }) => ({
	projects: many(project),
}));

export const projectRelations = relations(project, ({ one, many }) => ({
	client: one(client, {
		fields: [project.clientId],
		references: [client.id],
	}),
	projectMembers: many(projectMember),
	timeEntries: many(timeEntry),
}));

export const taskRelations = relations(task, ({ many }) => ({
	timeEntries: many(timeEntry),
	recurringBlockRules: many(recurringBlockRule),
}));

export const projectMemberRelations = relations(projectMember, ({ one }) => ({
	project: one(project, {
		fields: [projectMember.projectId],
		references: [project.id],
	}),
	user: one(user, {
		fields: [projectMember.userId],
		references: [user.id],
	}),
}));

export const recurringBlockRuleRelations = relations(
	recurringBlockRule,
	({ one, many }) => ({
		task: one(task, {
			fields: [recurringBlockRule.taskId],
			references: [task.id],
		}),
		project: one(project, {
			fields: [recurringBlockRule.projectId],
			references: [project.id],
		}),
		generatedEntries: many(timeEntry),
		skips: many(recurringBlockRuleSkip),
	}),
);

export const recurringBlockRuleSkipRelations = relations(
	recurringBlockRuleSkip,
	({ one }) => ({
		rule: one(recurringBlockRule, {
			fields: [recurringBlockRuleSkip.ruleId],
			references: [recurringBlockRule.id],
		}),
	}),
);

export const timeEntryRelations = relations(timeEntry, ({ one }) => ({
	project: one(project, {
		fields: [timeEntry.projectId],
		references: [project.id],
	}),
	task: one(task, {
		fields: [timeEntry.taskId],
		references: [task.id],
	}),
	user: one(user, {
		fields: [timeEntry.userId],
		references: [user.id],
	}),
	generatedFromRule: one(recurringBlockRule, {
		fields: [timeEntry.generatedFromRuleId],
		references: [recurringBlockRule.id],
	}),
}));
