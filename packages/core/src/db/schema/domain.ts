import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
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

export const projectStatus = pgEnum("project_status", ["active", "archived"]);
export const timeEntryTypeScope = pgEnum("time_entry_type_scope", [
	"site",
	"organization",
	"project",
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

export const client = pgTable(
	"client",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		name: text("name").notNull(),
		archivedAt: ts("archived_at"),
		...stamps,
	},
	(t) => [index("client_org_idx").on(t.organizationId)],
);

export const project = pgTable(
	"project",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		clientId: uuid("client_id").references(() => client.id, {
			onDelete: "set null",
		}),
		name: text("name").notNull(),
		code: text("code"),
		status: projectStatus("status").notNull().default("active"),
		billable: boolean("billable").notNull().default(true),
		billableRate: numeric("billable_rate", { precision: 12, scale: 2 }),
		currency: text("currency").notNull().default("USD"),
		color: text("color"),
		// Budget caps, both optional and independent — a project can have
		// neither, either, or both. Nothing enforces the cap; reports.service
		// just compares actuals against whichever is set.
		budgetSeconds: integer("budget_seconds"),
		budgetAmount: numeric("budget_amount", { precision: 12, scale: 2 }),
		...stamps,
	},
	(t) => [
		index("project_org_idx").on(t.organizationId),
		index("project_client_idx").on(t.clientId),
	],
);

export const task = pgTable(
	"task",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		billable: boolean("billable"), // null = inherit from project
		estimatedSeconds: integer("estimated_seconds"),
		archivedAt: ts("archived_at"),
		...stamps,
	},
	(t) => [
		index("task_project_idx").on(t.projectId),
		index("task_org_idx").on(t.organizationId),
	],
);

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
		billableRate: numeric("billable_rate", { precision: 12, scale: 2 }),
		costRate: numeric("cost_rate", { precision: 12, scale: 2 }),
		// Whether this member may approve/deny time-off requests of other members
		// on this project (see timeOffService.canDecide / listEligibleReviewers).
		isVacationApprover: boolean("is_vacation_approver")
			.notNull()
			.default(false),
		...stamps,
	},
	(t) => [unique("project_member_unq").on(t.projectId, t.userId)],
);

// Entry-type taxonomy: site-scoped rows are platform defaults (seed-only, not
// creatable through the app by any org), organization-scoped are admin-created
// and org-wide, project-scoped are admin-created and only apply to one project.
export const timeEntryType = pgTable(
	"time_entry_type",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		scope: timeEntryTypeScope("scope").notNull(),
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "cascade",
		}),
		projectId: uuid("project_id").references(() => project.id, {
			onDelete: "cascade",
		}),
		name: text("name").notNull(),
		color: text("color"),
		description: text("description"),
		billableDefault: boolean("billable_default").notNull().default(true),
		archivedAt: ts("archived_at"),
		...stamps,
	},
	(t) => [
		index("time_entry_type_org_idx").on(t.organizationId),
		index("time_entry_type_project_idx").on(t.projectId),
		check(
			"tet_org_scope_consistency",
			sql`
      (${t.scope} = 'site' and ${t.organizationId} is null) or
      (${t.scope} != 'site' and ${t.organizationId} is not null)`,
		),
		check(
			"tet_project_scope_consistency",
			sql`
      (${t.scope} = 'project' and ${t.projectId} is not null) or
      (${t.scope} != 'project' and ${t.projectId} is null)`,
		),
		uniqueIndex("tet_site_name_uidx")
			.on(t.name)
			.where(sql`${t.scope} = 'site' and ${t.archivedAt} is null`),
		uniqueIndex("tet_org_name_uidx")
			.on(t.organizationId, t.name)
			.where(sql`${t.scope} = 'organization' and ${t.archivedAt} is null`),
		uniqueIndex("tet_project_name_uidx")
			.on(t.projectId, t.name)
			.where(sql`${t.scope} = 'project' and ${t.archivedAt} is null`),
	],
);

// A per-user recurring default block (e.g. a daily lunch break) that gets
// materialized into real time_entry rows on read (see time-entries.service).
export const recurringBlockRule = pgTable(
	"recurring_block_rule",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		typeId: uuid("type_id")
			.notNull()
			.references(() => timeEntryType.id, { onDelete: "restrict" }),
		projectId: uuid("project_id").references(() => project.id, {
			onDelete: "set null",
		}),
		description: text("description").notNull().default(""),
		daysOfWeek: integer("days_of_week").array().notNull(), // 0=Sun..6=Sat, matches Date#getDay()
		startTime: text("start_time").notNull(), // "HH:mm", local to org tz
		durationSeconds: integer("duration_seconds").notNull(),
		effectiveFrom: text("effective_from"), // yyyy-MM-dd, null = unbounded start
		effectiveUntil: text("effective_until"), // yyyy-MM-dd, null = ongoing
		active: boolean("active").notNull().default(true),
		...stamps,
	},
	(t) => [
		index("rbr_org_user_idx").on(t.organizationId, t.userId),
		index("rbr_type_idx").on(t.typeId),
		check(
			"rbr_days_of_week_valid",
			sql`${t.daysOfWeek} <@ ARRAY[0,1,2,3,4,5,6]::integer[]`,
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

export const timeEntry = pgTable(
	"time_entry",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		projectId: uuid("project_id").references(() => project.id, {
			onDelete: "restrict",
		}),
		taskId: uuid("task_id").references(() => task.id, {
			onDelete: "set null",
		}),
		typeId: uuid("type_id")
			.notNull()
			.references(() => timeEntryType.id, { onDelete: "restrict" }),
		description: text("description").notNull().default(""),
		startedAt: ts("started_at").notNull(),
		stoppedAt: ts("stopped_at").notNull(),
		durationSeconds: integer("duration_seconds").notNull(),
		// Optional Google Calendar meeting attached to this entry: the join link
		// and the source event id (kept so the same event isn't imported twice).
		meetingUrl: text("meeting_url"),
		calendarEventId: text("calendar_event_id"),
		// True once the user takes ownership of a calendar-linked entry — either by
		// manually attaching a calendar event or by editing an auto-synced meeting.
		// The meeting-sync engine treats Google as the source of truth ONLY for
		// rows where this is false: it upserts/deletes those to mirror the calendar,
		// but never overwrites or deletes a locked (user-owned) row.
		syncLocked: boolean("sync_locked").notNull().default(false),
		// A "work time" block whose duration is not entered by hand but auto-set to
		// the rest of the day's target working hours minus every other entry that
		// day (see timeEntriesService.recomputeDayFill). At most one per user/day.
		fillsDay: boolean("fills_day").notNull().default(false),
		// Set together when this entry was auto-materialized from a recurring rule.
		generatedFromRuleId: uuid("generated_from_rule_id").references(
			() => recurringBlockRule.id,
			{ onDelete: "set null" },
		),
		generatedForDate: text("generated_for_date"), // yyyy-MM-dd, idempotency key
		// yyyy-MM-dd (org tz), set ONLY when fillsDay is true — backs the
		// te_fill_day_uidx partial unique index below so "one fill block per
		// user/day" is enforced by the DB, not just a pre-insert findFirst check.
		fillDate: text("fill_date"),
		billable: boolean("billable").notNull().default(true),
		billableRateSnapshot: numeric("billable_rate_snapshot", {
			precision: 12,
			scale: 2,
		}), // frozen at invoice time
		...stamps,
	},
	(t) => [
		index("te_org_user_started_idx").on(
			t.organizationId,
			t.userId,
			t.startedAt,
		),
		index("te_project_idx").on(t.projectId),
		index("te_type_idx").on(t.typeId),
		index("te_rule_idx").on(t.generatedFromRuleId),
		uniqueIndex("te_generated_once_uidx")
			.on(t.generatedFromRuleId, t.generatedForDate)
			.where(sql`${t.generatedFromRuleId} is not null`),
		// One entry per source calendar event per user/org, so the meeting-sync
		// engine can upsert idempotently (onConflictDoUpdate, gated on sync_locked)
		// and tell which imported meetings have disappeared from the calendar.
		uniqueIndex("te_calendar_event_uidx")
			.on(t.organizationId, t.userId, t.calendarEventId)
			.where(sql`${t.calendarEventId} is not null`),
		// At most one fill block per user/day, enforced in the DB (a race between
		// two concurrent creates could otherwise both pass the app-level check).
		uniqueIndex("te_fill_day_uidx")
			.on(t.organizationId, t.userId, t.fillDate)
			.where(sql`${t.fillsDay} = true`),
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
	tasks: many(task),
	projectMembers: many(projectMember),
	timeEntries: many(timeEntry),
	entryTypes: many(timeEntryType),
}));

export const taskRelations = relations(task, ({ one, many }) => ({
	project: one(project, {
		fields: [task.projectId],
		references: [project.id],
	}),
	timeEntries: many(timeEntry),
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

export const timeEntryTypeRelations = relations(
	timeEntryType,
	({ one, many }) => ({
		project: one(project, {
			fields: [timeEntryType.projectId],
			references: [project.id],
		}),
		timeEntries: many(timeEntry),
		recurringBlockRules: many(recurringBlockRule),
	}),
);

export const recurringBlockRuleRelations = relations(
	recurringBlockRule,
	({ one, many }) => ({
		type: one(timeEntryType, {
			fields: [recurringBlockRule.typeId],
			references: [timeEntryType.id],
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
	type: one(timeEntryType, {
		fields: [timeEntry.typeId],
		references: [timeEntryType.id],
	}),
	generatedFromRule: one(recurringBlockRule, {
		fields: [timeEntry.generatedFromRuleId],
		references: [recurringBlockRule.id],
	}),
}));
