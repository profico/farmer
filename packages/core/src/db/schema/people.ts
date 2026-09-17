import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

import { invitation, organization, user } from "./auth";

// The single most consequential field in the reporting layer (PRD 3.1, revised
// Sept 2026). Three kinds of person, each with one attribute:
//  - employee_billable     delivery people whose time we sell. Every report and
//                          reminder applies to them; Expected is the hour fund.
//  - employee_overhead     COO / CEO / admin / marketing. Never reminded, no
//                          Expected — but when they DO log time it flows through
//                          the Time Report exactly like anyone else's.
//  - student_full_time,    the hour fund applies to them like an employee.
//    contractor_full_time
//  - student_hourly,       no monthly hour fund, so no Expected value by
//    contractor_hourly     default, unless an explicit override is set.
// Values are mirrored in `schema/members.ts` (`memberTypeEnum`), which is what
// the forms and the server functions validate against.
export const memberType = pgEnum("member_type", [
	"employee_billable",
	"employee_overhead",
	"student_full_time",
	"student_hourly",
	"contractor_full_time",
	"contractor_hourly",
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

// The org-scoped half of a Person. Name/email live on better-auth's `user`, and
// membership on `member`; this holds the fields the PRD adds. Deliberately tiny:
// no title, no team, no seniority, no weekly capacity (PRD 3.1).
export const memberProfile = pgTable(
	"member_profile",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		startDate: text("start_date"), // yyyy-MM-dd
		// Person status (PRD 3.1): Active while null, Archived once set. Archiving
		// rather than deleting, because agencies churn and every report
		// and time entry the person appears on has to survive them leaving. An
		// archived person drops out of the forward-looking surfaces — reminders,
		// compliance, the assignment picker — and
		// stays in every historical one.
		archivedAt: ts("archived_at"),
		...stamps,
	},
	(t) => [unique("member_profile_org_user_unq").on(t.organizationId, t.userId)],
);

// Person type is effective-dated because type changes must preserve history: the
// known real case is a contractor becoming an employee, and reports for past
// months have to reflect the type the person held at that time (PRD 3.1).
//
// Two invariants, and only one of them is visible in this file:
//  - at most one open-ended row per (org, user), held by `mth_current_uidx`;
//  - no two segments cover the same day, held by the `mth_no_overlap` TRIGGER
//    added in migration 0035. Drizzle does not model triggers, so it exists in
//    the migration and nowhere else in the schema — the migration header says
//    why it is a trigger and not an `EXCLUDE USING gist` constraint.
// `membersService.setType` is the only writer and maintains both in one
// transaction; `typesAsOf` reads them as its guarantee of a single match.
export const memberTypeHistory = pgTable(
	"member_type_history",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		type: memberType("type").notNull().default("employee_billable"),
		// Hourly people have no monthly hour fund, so no Expected value — unless
		// one is set here, in which case the pace check treats them like a
		// full-time person with that fund. Null for everyone else.
		expectedSecondsOverride: integer("expected_seconds_override"),
		effectiveFrom: text("effective_from").notNull(), // yyyy-MM-dd, inclusive
		effectiveUntil: text("effective_until"), // yyyy-MM-dd exclusive, null = current
		...stamps,
	},
	(t) => [
		index("mth_org_user_idx").on(t.organizationId, t.userId, t.effectiveFrom),
		// Exactly one current (open-ended) type row per person per org.
		uniqueIndex("mth_current_uidx")
			.on(t.organizationId, t.userId)
			.where(sql`${t.effectiveUntil} is null`),
		check(
			"mth_range_valid",
			sql`${t.effectiveUntil} is null or ${t.effectiveUntil} > ${t.effectiveFrom}`,
		),
	],
);

// Whether an invitation's email reached the mail provider. better-auth's
// `invitation` row records that somebody was invited, not that they were told —
// and the send runs after `createInvitation` has returned (see
// `sendInvitationEmail` in auth/index.ts), so without this a failed send was a
// log line and an invite nobody would ever see. Beside `invitation` rather than
// on it because that table is CLI-owned. No row means the invitation predates
// this table, not that its email failed.
export const invitationEmailStatus = pgEnum("invitation_email_status", [
	"sending",
	"sent",
	"failed",
]);

export const invitationEmail = pgTable(
	"invitation_email",
	{
		invitationId: text("invitation_id")
			.primaryKey()
			.references(() => invitation.id, { onDelete: "cascade" }),
		organizationId: org(),
		status: invitationEmailStatus("status").notNull(),
		// The provider's own words when a send failed, shown on the badge.
		error: text("error"),
		...stamps,
	},
	(t) => [index("invitation_email_org_idx").on(t.organizationId)],
);

export const memberProfileRelations = relations(memberProfile, ({ one }) => ({
	user: one(user, {
		fields: [memberProfile.userId],
		references: [user.id],
	}),
}));

export const memberTypeHistoryRelations = relations(
	memberTypeHistory,
	({ one }) => ({
		user: one(user, {
			fields: [memberTypeHistory.userId],
			references: [user.id],
		}),
	}),
);

// A Team Lead's people (revised Sept 2026). A lead sees everything about the
// people on their list — their time on every project, their Tracking status,
// their time off — and, once assigned to a project, sees that project as a PM
// does. Edited by an Admin on the Members page; a person may be on several
// leads' lists. Being a Team Lead IS having a non-empty list: there is no flag.
export const teamLeadPerson = pgTable(
	"team_lead_person",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		leadUserId: text("lead_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		personUserId: text("person_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: ts("created_at").notNull().defaultNow(),
	},
	(t) => [
		unique("team_lead_person_unq").on(
			t.organizationId,
			t.leadUserId,
			t.personUserId,
		),
		index("team_lead_person_lead_idx").on(t.organizationId, t.leadUserId),
		check(
			"team_lead_person_not_self",
			sql`${t.leadUserId} <> ${t.personUserId}`,
		),
	],
);
