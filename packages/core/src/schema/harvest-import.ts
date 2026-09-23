import { z } from "zod";

import { dayKeySchema } from "./day-key";
import { memberTypeEnum } from "./members";
import { projectTypeEnum } from "./projects";

// The inputs of `harvest-import.service.ts`. The browser parses the export
// and builds the plan (`lib/harvest/plan.ts`); these are the shapes it sends.
// Everything is named by SOURCE key — the normalized Harvest name — and the
// server resolves a source key to a local id through `import_mapping`, so a
// request cannot point an entry at a row of another organization.

const sourceKey = z.string().min(1).max(500);
const email = z.email().max(320);

/** The widest range a snapshot may read. Far above the 62-day entry cap and
 *  the 366-day report cap on purpose: the snapshot is the whole history an
 *  export spans (the real one runs 2014-12 to 2026-09, twelve years), read once
 *  per import by an admin. It still has a ceiling, so a hand-made request
 *  cannot ask for every entry since year 1. */
export const HARVEST_SNAPSHOT_MAX_YEARS = 20;

export const harvestSnapshotInput = z
	.object({
		from: dayKeySchema,
		to: dayKeySchema,
		// The addresses the plan wants to use: the people list and the guesses.
		// The answer says which of them already belong to a user outside this org.
		emails: z.array(email).max(2000),
	})
	.refine((v) => v.from <= v.to, {
		message: "The range ends before it starts",
		path: ["to"],
	})
	.refine(
		(v) =>
			(Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <=
			HARVEST_SNAPSHOT_MAX_YEARS * 366,
		{
			message: `Range too large (max ${HARVEST_SNAPSHOT_MAX_YEARS} years)`,
			path: ["to"],
		},
	);
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
	z.object({
		action: z.literal("match"),
		sourceKey,
		localId: z.uuid(),
		// The file's verdict on a project that already exists here: worked on
		// in the window before the cutoff (or listed) means active.
		archived: z.boolean(),
	}),
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
		startDate: dayKeySchema.nullable(),
	}),
	z.object({
		action: z.literal("create"),
		sourceKey,
		name: z.string().trim().min(1).max(200),
		email,
		// True for an address from the people list. Only such an address may
		// attach a user that exists already (see `start`).
		emailListed: z.boolean(),
		// True when somebody vouches for the address: the people list, or an
		// admin who typed it on the review screen. Only a guess stays false,
		// and an unverified address is one better-auth refuses to link a
		// Google sign-in to (plan section 3.3).
		emailConfirmed: z.boolean(),
		role: z.enum(["admin", "member"]),
		type: memberTypeEnum,
		startDate: dayKeySchema,
		archivedOn: dayKeySchema.nullable(),
	}),
	// A second Harvest spelling of a person in the plan ("Ive Vasiljević" and
	// "Ive Vasiljevic"), that the admin said is the same person. It gets a
	// mapping to `of`'s user, so its rows and a later run resolve to them.
	z.object({ action: z.literal("alias"), sourceKey, of: sourceKey }),
]);

export const harvestStartInput = z.object({
	// Made by the browser, once per import attempt, and used as the run's id.
	// It is what makes `start` safe to repeat: when the first call committed
	// but its answer was lost, "Retry" sends the same id and gets that run
	// back, instead of a second run that the first one's mappings refuse.
	runId: z.uuid(),
	source: z.literal("harvest"),
	cutoffDate: dayKeySchema,
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
	date: dayKeySchema,
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
		.array(z.object({ personSourceKey: sourceKey, date: dayKeySchema }))
		.min(1)
		.max(HARVEST_CHUNK_MAX_ROWS),
});
export type HarvestRemoveDaysInput = z.infer<typeof harvestRemoveDaysInput>;

export const harvestFinishInput = z.object({
	runId: z.uuid(),
});
export type HarvestFinishInput = z.infer<typeof harvestFinishInput>;

export const harvestRunIdInput = z.object({ runId: z.uuid() });
export type HarvestRunIdInput = z.infer<typeof harvestRunIdInput>;
