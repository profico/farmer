import { z } from "zod";

import { memberTypeEnum } from "./members";
import { projectTypeEnum } from "./projects";

// The inputs of `harvest-import.service.ts`. The browser parses the export
// and builds the plan (`lib/harvest/plan.ts`); these are the shapes it sends.
// Everything is named by SOURCE key — the normalized Harvest name — and the
// server resolves a source key to a local id through `import_mapping`, so a
// request cannot point an entry at a row of another organization.

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-MM-dd");
const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use yyyy-MM");
const sourceKey = z.string().min(1).max(500);
const email = z.email().max(320);

export const harvestSnapshotInput = z.object({
	from: dateKey,
	to: dateKey,
	// The addresses the plan wants to use: the people list and the guesses.
	// The answer says which of them already belong to a user outside this org.
	emails: z.array(email).max(2000),
});
export type HarvestSnapshotInput = z.infer<typeof harvestSnapshotInput>;

export const harvestEmailsInput = z.object({
	emails: z.array(email).min(1).max(500),
});
export type HarvestEmailsInput = z.infer<typeof harvestEmailsInput>;

const clientPlan = z.discriminatedUnion("action", [
	z.object({ action: z.literal("match"), sourceKey, localId: z.uuid() }),
	z.object({ action: z.literal("internal"), sourceKey }),
	z.object({
		action: z.literal("create"),
		sourceKey,
		name: z.string().trim().min(1).max(200),
		archived: z.boolean(),
	}),
]);

const taskPlan = z.discriminatedUnion("action", [
	z.object({ action: z.literal("match"), sourceKey, localId: z.uuid() }),
	z.object({
		action: z.literal("create"),
		sourceKey,
		name: z.string().trim().min(1).max(200),
		archived: z.boolean(),
	}),
]);

const projectPlan = z.discriminatedUnion("action", [
	z.object({ action: z.literal("match"), sourceKey, localId: z.uuid() }),
	z.object({
		action: z.literal("create"),
		sourceKey,
		clientSourceKey: sourceKey,
		name: z.string().trim().min(1).max(200),
		code: z.string().trim().max(16).nullable(),
		type: projectTypeEnum,
		archived: z.boolean(),
		budgetSeconds: z.number().int().positive().nullable(),
	}),
]);

const personPlan = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("match"),
		sourceKey,
		localId: z.string().min(1),
		// Fills the profile's start date only when it is empty.
		startDate: dateKey.nullable(),
	}),
	z.object({
		action: z.literal("create"),
		sourceKey,
		name: z.string().trim().min(1).max(200),
		email,
		// True for an address from the people list, false for a guess. A
		// guessed address stays unverified, so better-auth refuses to link a
		// Google sign-in to it (plan section 3.3).
		emailListed: z.boolean(),
		role: z.enum(["admin", "member"]),
		type: memberTypeEnum,
		startDate: dateKey,
		archivedOn: dateKey.nullable(),
		weeklyTargetSeconds: z
			.number()
			.int()
			.min(0)
			.max(7 * 24 * 3600),
	}),
	// A second Harvest spelling of a person in the plan ("Ive Vasiljević" and
	// "Ive Vasiljevic"), that the admin said is the same person. It gets a
	// mapping to `of`'s user, so its rows and a later run resolve to them.
	z.object({ action: z.literal("alias"), sourceKey, of: sourceKey }),
]);

export const harvestStartInput = z.object({
	source: z.literal("harvest"),
	cutoffDate: dateKey,
	clients: z.array(clientPlan).max(5000),
	tasks: z.array(taskPlan).max(2000),
	projects: z.array(projectPlan).max(5000),
	people: z.array(personPlan).max(2000),
	projectMembers: z
		.array(
			z.object({
				projectSourceKey: sourceKey,
				personSourceKey: sourceKey,
				active: z.boolean(),
			}),
		)
		.max(50_000),
	projectTasks: z
		.array(z.object({ projectSourceKey: sourceKey, taskSourceKey: sourceKey }))
		.max(50_000),
});
export type HarvestStartInput = z.infer<typeof harvestStartInput>;
export type HarvestClientPlan = z.infer<typeof clientPlan>;
export type HarvestTaskPlan = z.infer<typeof taskPlan>;
export type HarvestProjectPlan = z.infer<typeof projectPlan>;
export type HarvestPersonPlan = z.infer<typeof personPlan>;

/** The most rows one `importDays` call may carry. Whole person-days only, so a
 *  chunk can hold a little less than this. */
export const HARVEST_CHUNK_MAX_ROWS = 5000;

const importRow = z.object({
	key: z.string().min(1).max(100),
	// Null for absence: an absence entry carries no project.
	projectSourceKey: sourceKey.nullable(),
	taskSourceKey: sourceKey,
	description: z.string().max(10_000),
	// Rounded to the quarter hour, and never over a day (plan section 4).
	durationSeconds: z
		.number()
		.int()
		.min(900)
		.max(24 * 3600)
		.multipleOf(900),
	overtime: z.boolean(),
});
export type HarvestImportRow = z.infer<typeof importRow>;

const importDay = z.object({
	personSourceKey: sourceKey,
	date: dateKey,
	rows: z.array(importRow).min(1).max(500),
});
export type HarvestImportDay = z.infer<typeof importDay>;

export const harvestImportDaysInput = z
	.object({
		runId: z.uuid(),
		days: z.array(importDay).min(1).max(HARVEST_CHUNK_MAX_ROWS),
	})
	.refine(
		(v) =>
			v.days.reduce((n, d) => n + d.rows.length, 0) <= HARVEST_CHUNK_MAX_ROWS,
		{ message: `A chunk carries at most ${HARVEST_CHUNK_MAX_ROWS} rows` },
	);
export type HarvestImportDaysInput = z.infer<typeof harvestImportDaysInput>;

export const harvestRemoveDaysInput = z.object({
	runId: z.uuid(),
	days: z
		.array(z.object({ personSourceKey: sourceKey, date: dateKey }))
		.min(1)
		.max(HARVEST_CHUNK_MAX_ROWS),
});
export type HarvestRemoveDaysInput = z.infer<typeof harvestRemoveDaysInput>;

export const harvestFinishInput = z.object({
	runId: z.uuid(),
	// The last month that gets a finalized history close. Null skips them.
	historyThrough: monthKey.nullable(),
	// Harvest's billable hours, rounded, for each project, person and month.
	// They become the closes' Final (plan section 6). A missing one is zero.
	billable: z
		.array(
			z.object({
				projectSourceKey: sourceKey,
				personSourceKey: sourceKey,
				month: monthKey,
				seconds: z.number().int().min(0),
			}),
		)
		.max(100_000),
});
export type HarvestFinishInput = z.infer<typeof harvestFinishInput>;

export const harvestRunIdInput = z.object({ runId: z.uuid() });
export type HarvestRunIdInput = z.infer<typeof harvestRunIdInput>;
