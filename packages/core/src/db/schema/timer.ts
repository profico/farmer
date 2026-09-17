import {
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { project, task } from "./domain";

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

// The stopwatch (issues #59 and #43). It measures; it does not record. A time
// entry is still a date and a duration in 15-minute steps — see
// `schema/domain.ts` — and this row only produces one: nothing is written until
// the person confirms the figure, snapped, in the form that stopping opens.
//
// **Keyed on the person, not on (organization, person)**, which is the one
// place in this package where a table is not tenanted. A person works one hour
// at a time. Keyed per org, somebody in two workspaces could run two clocks
// over the same hour and log it twice, and neither clock could see the other.
// `pushSubscription` is the other table keyed on the human for the same kind of
// reason. `organizationId` here says which workspace the entry will land in, so
// every read still names an organization and `timersService` still checks it.
//
// One row at a time, and it ends in exactly one of three ways: confirmed (the
// entry is written and the row goes), discarded, or dropped by `timer-sweep`
// once it passes the person's own cap — `droppedAt`, which is shown on the next
// read rather than deleted, because a person who was told nothing would only
// find out that nothing was logged at the end of the month.
export const runningTimer = pgTable(
	"running_timer",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// Null is a timer on work nobody has filed yet — the same "unfiled" state
		// a time entry may hold.
		projectId: uuid("project_id").references(() => project.id, {
			onDelete: "cascade",
		}),
		// An entry always carries a task, so the timer does too. Absence tasks are
		// refused at `start`: time off is a span somebody books, not a stopwatch.
		taskId: uuid("task_id")
			.notNull()
			.references(() => task.id, { onDelete: "cascade" }),
		description: text("description").notNull().default(""),
		startedAt: ts("started_at").notNull().defaultNow(),
		// Set by `jobs/timer-sweep.ts` when the timer passed the person's cap. The
		// row stops measuring and becomes a notice, cleared by `dismiss`.
		droppedAt: ts("dropped_at"),
		...stamps,
	},
	(t) => [
		unique("running_timer_user_unq").on(t.userId),
		index("running_timer_started_idx").on(t.startedAt),
	],
);

// A person's own ceiling on a timer they forgot, in seconds. The default of 12
// hours is longer than any day somebody means to work and shorter than the
// weekend a forgotten timer would otherwise run through. A missing row means
// the default, as it does for `notificationSettings`.
//
// It is a preference, not a policy: it is set on Settings -> Preferences and
// nobody else's number depends on it. An organization-wide ceiling would be a
// different thing, on `orgSettings`, and no one has asked for one.
export const timerSettings = pgTable(
	"timer_settings",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		maxSeconds: integer("max_seconds")
			.notNull()
			.default(12 * 3600),
		...stamps,
	},
	(t) => [unique("timer_settings_org_user_unq").on(t.organizationId, t.userId)],
);
