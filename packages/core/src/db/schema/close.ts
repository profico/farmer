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
	uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { project } from "./domain";

// Open -> PM Submitted -> Finalized (PRD 5.2). A PM may re-open and re-submit
// freely before finalization; an Admin may finalize even if the PM never
// submitted (PM on vacation), and may re-open a finalized month.
export const closeStatus = pgEnum("close_status", [
	"open",
	"submitted",
	"finalized",
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

// One close sheet per project per month (PRD 5.1) — the structured, stateful
// replacement for the two-layer Google Sheet reconciliation. This is the anchor
// feature: Final values are the single source of truth for accounting.
export const monthlyClose = pgTable(
	"monthly_close",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		year: integer("year").notNull(),
		month: integer("month").notNull(), // 1-12
		status: closeStatus("status").notNull().default("open"),
		submittedAt: ts("submitted_at"),
		// set null rather than cascade: a submitted/finalized month must not break
		// if the acting user's account is later removed.
		submittedByUserId: text("submitted_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		finalizedAt: ts("finalized_at"),
		finalizedByUserId: text("finalized_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		...stamps,
	},
	(t) => [
		unique("monthly_close_unq").on(
			t.organizationId,
			t.projectId,
			t.year,
			t.month,
		),
		index("monthly_close_period_idx").on(t.organizationId, t.year, t.month),
		check(
			"monthly_close_month_valid",
			sql`${t.month} >= 1 and ${t.month} <= 12`,
		),
	],
);

// One row per person on the sheet, generated from the project's active
// assignments. Reported / Expected / Overtime are computed live from entries and
// deliberately NOT stored — until the month is finalized, at which point they are
// snapshotted (see below).
export const monthlyCloseRow = pgTable(
	"monthly_close_row",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		closeId: uuid("close_id")
			.notNull()
			.references(() => monthlyClose.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// Null means "not touched yet", which displays as (and computes from) the
		// live Reported value. Storing null rather than eagerly copying Reported
		// keeps an untouched row tracking late entries until the PM actually acts.
		adjustedSeconds: integer("adjusted_seconds"),
		// Admin-only. Null means "defaults to Adjusted".
		finalSeconds: integer("final_seconds"),
		// The PM's override of the computed absence-day count. Lives on the sheet
		// ONLY and never writes back to the person's Vacation/Sick entries: if the
		// two diverge that is a signal the person forgot to log absence, not a data
		// error (PRD 5.1, decision 3).
		absenceDaysOverride: integer("absence_days_override"),
		comment: text("comment"),
		// ── Finalization snapshots ──────────────────────────────────────────────
		// Entries stay editable forever, including in finalized months (decision 2),
		// so Reported keeps moving after the fact. Report 6.4 compares Reported to
		// Final, which is only meaningful against the Reported value as it stood
		// when Final was frozen — hence these. Expected is frozen for the same
		// reason: an admin editing a past month's hour fund must not retroactively
		// move every utilization percentage that was already reported.
		// Null until the close is finalized; re-opening deliberately leaves them in
		// place so the previous finalization stays auditable.
		reportedAtFinalizeSeconds: integer("reported_at_finalize_seconds"),
		expectedAtFinalizeSeconds: integer("expected_at_finalize_seconds"),
		overtimeAtFinalizeSeconds: integer("overtime_at_finalize_seconds"),
		...stamps,
	},
	(t) => [
		unique("monthly_close_row_unq").on(t.closeId, t.userId),
		index("monthly_close_row_user_idx").on(t.organizationId, t.userId),
	],
);

export const monthlyCloseRelations = relations(
	monthlyClose,
	({ one, many }) => ({
		project: one(project, {
			fields: [monthlyClose.projectId],
			references: [project.id],
		}),
		rows: many(monthlyCloseRow),
	}),
);

export const monthlyCloseRowRelations = relations(
	monthlyCloseRow,
	({ one }) => ({
		close: one(monthlyClose, {
			fields: [monthlyCloseRow.closeId],
			references: [monthlyClose.id],
		}),
		user: one(user, {
			fields: [monthlyCloseRow.userId],
			references: [user.id],
		}),
	}),
);
