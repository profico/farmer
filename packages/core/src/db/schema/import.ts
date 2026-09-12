import { sql } from "drizzle-orm";
import {
	boolean,
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

// One admin-run import of another tool's exports (today: Harvest CSVs). The run
// is what an undo reverses, so every row an import writes points back at one.
export const importRunStatus = pgEnum("import_run_status", [
	"started",
	"finished",
	"undone",
]);

// What an `import_mapping` row maps. `close` is no longer written (the history
// closes went with the month-end close); the enum value stays because Postgres
// cannot drop one, and old rows may still carry it.
export const importMappingKind = pgEnum("import_mapping_kind", [
	"client",
	"project",
	"task",
	"person",
	"close",
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

export const importRun = pgTable(
	"import_run",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		source: text("source").notNull(),
		createdByUserId: text("created_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		// yyyy-MM-dd. Work rows on or after it were left to this app.
		cutoffDate: text("cutoff_date").notNull(),
		status: importRunStatus("status").notNull().default("started"),
		entriesCreated: integer("entries_created").notNull().default(0),
		entriesDeleted: integer("entries_deleted").notNull().default(0),
		finishedAt: ts("finished_at"),
		undoneAt: ts("undone_at"),
		...stamps,
	},
	(t) => [index("import_run_org_idx").on(t.organizationId, t.createdAt)],
);

// The source's name for a thing, and the row it became here. A second import
// resolves through this rather than by name again, so a rename in this app does
// not fork the history. `created` separates a row the run made (undo deletes
// it) from an existing row the run matched (undo leaves it alone).
export const importMapping = pgTable(
	"import_mapping",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		runId: uuid("run_id")
			.notNull()
			.references(() => importRun.id, { onDelete: "cascade" }),
		kind: importMappingKind("kind").notNull(),
		sourceKey: text("source_key").notNull(),
		// Text, not a uuid: a person maps to a better-auth user id.
		localId: text("local_id").notNull(),
		created: boolean("created").notNull(),
		...stamps,
	},
	(t) => [
		unique("import_mapping_unq").on(t.organizationId, t.kind, t.sourceKey),
		index("import_mapping_run_idx")
			.on(t.runId)
			.where(sql`${t.created} = true`),
	],
);
