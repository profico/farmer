// The monthly close, pinned — the numbers this file computes are the numbers
// that get invoiced, and it had no test.
//
// Three properties are worth more than the rest and are what this suite is
// built around:
//
//   1. NOBODY FALLS OFF THE SHEET. Rows are the union of the project's active
//      assignments, everyone who actually logged time on it that month, and
//      anyone already stored on the sheet. An unassigned contributor's hours
//      silently vanishing is a billing error, not a display bug.
//   2. FINALIZE SNAPSHOTS. Entries stay editable in finalized months on purpose,
//      so Reported keeps moving afterwards. Report 6.4 compares Reported to
//      Final and is only meaningful against Reported as it stood when Final was
//      frozen. If the snapshot ever stopped being written, every variance figure
//      would drift quietly and stay plausible.
//   3. FINALIZE REFUSES UNFILED TIME. The one hard stop. Freezing a month while
//      somebody still has unattributed hours means that time later lands on a
//      month already closed against a number that predates it.
//
// Plus the lifecycle guards (who may submit, finalize and re-open) and the
// Expected formula, which is pure and cheap to pin exhaustively.
//
// Runs on PGLite (src/test/harness): the aggregates are SQL, and the whole point
// of a close sheet is which rows the GROUP BY did and didn't include.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { monthlyClose, monthlyCloseRow } from "../db/schema/close";
import {
	client,
	project,
	projectMember,
	projectTask,
	task,
	timeEntry,
} from "../db/schema/domain";
import { memberTypeHistory } from "../db/schema/people";
import { monthlyHourFund } from "../db/schema/settings";
import { createTestDb, type TestDb } from "../test/harness";
import { AccessError } from "./access.service";
import {
	type CloseSheet,
	type CloseSheetRow,
	closeService,
	effectiveAdjusted,
	effectiveFinal,
	expectedSecondsFor,
} from "./close.service";
import type { Ctx } from "./types";

const H = 3600;
const DAY = 8 * H;

const ORG = "close-org";
const YEAR = 2026;
const MONTH = 3; // March 2026

// Everyone in the fixture. `pm` runs the project, `admin` is the org admin,
// `worker` is a plain assigned member, `drifter` logged time without ever being
// assigned (property 1), and `contractor` has no hour fund.
const PM = "u-pm";
const ADMIN = "u-admin";
const WORKER = "u-worker";
const DRIFTER = "u-drifter";
const CONTRACTOR = "u-contractor";
/** A real user row with NO membership in this org — somebody else's person. */
const OUTSIDER = "u-outsider";

let harness: TestDb;
let productProjectId: string;
let internalProjectId: string;
let devTaskId: string;
let vacationTaskId: string;
let breakTaskId: string;

const ctxFor = (userId: string): Ctx => ({ organizationId: ORG, userId });

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values({
		id: ORG,
		name: "Close Org",
		slug: "close-org",
		createdAt: new Date(),
	});

	await db.insert(user).values(
		[PM, ADMIN, WORKER, DRIFTER, CONTRACTOR, OUTSIDER].map((id) => ({
			id,
			// Names drive the sheet's sort order, so they are deliberately not in
			// alphabetical agreement with the ids.
			name: id.replace("u-", ""),
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

	await db.insert(member).values([
		{
			id: "mm-admin",
			organizationId: ORG,
			userId: ADMIN,
			role: "admin",
			createdAt: new Date(),
		},
		{
			id: "mm-pm",
			organizationId: ORG,
			userId: PM,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "mm-worker",
			organizationId: ORG,
			userId: WORKER,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "mm-drifter",
			organizationId: ORG,
			userId: DRIFTER,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "mm-contractor",
			organizationId: ORG,
			userId: CONTRACTOR,
			role: "member",
			createdAt: new Date(),
		},
	]);

	const [c] = await db
		.insert(client)
		.values({ organizationId: ORG, name: "Acme" })
		.returning();
	if (!c) throw new Error("Failed to seed client");

	// product_team is the only type that carries Expected/absence columns; the
	// internal project is here to prove the lean sheet really is lean.
	const [product, internal] = await db
		.insert(project)
		.values([
			{
				organizationId: ORG,
				clientId: c.id,
				name: "Product",
				type: "product_team" as const,
			},
			{
				organizationId: ORG,
				clientId: c.id,
				name: "Internal",
				type: "internal" as const,
			},
		])
		.returning();
	if (!product || !internal) throw new Error("Failed to seed projects");
	productProjectId = product.id;
	internalProjectId = internal.id;

	await db.insert(projectMember).values([
		{
			organizationId: ORG,
			projectId: productProjectId,
			userId: PM,
			role: "pm",
			active: true,
		},
		{
			organizationId: ORG,
			projectId: productProjectId,
			userId: WORKER,
			role: "member",
			active: true,
		},
		{
			organizationId: ORG,
			projectId: productProjectId,
			userId: CONTRACTOR,
			role: "member",
			active: true,
		},
		{
			organizationId: ORG,
			projectId: internalProjectId,
			userId: PM,
			role: "pm",
			active: true,
		},
		// DRIFTER is deliberately assigned to NOTHING.
	]);

	// Meeting and Break are site built-ins created by migration 0024, so they are
	// already here — look Break up rather than inserting a duplicate that
	// task_site_name_uidx would reject. Vacation comes from the seed script
	// (db/seed-tasks.ts), which the harness does not run, so it is inserted.
	const [dev, vacation] = await db
		.insert(task)
		.values([
			{
				scope: "organization" as const,
				organizationId: ORG,
				name: "Development",
				systemKey: "development" as const,
			},
			{
				scope: "site" as const,
				name: "Vacation",
				isAbsence: true,
				systemKey: "vacation" as const,
			},
		])
		.returning();
	if (!dev || !vacation) throw new Error("Failed to seed tasks");
	devTaskId = dev.id;
	vacationTaskId = vacation.id;

	const brk = await db.query.task.findFirst({
		where: and(eq(task.scope, "site"), eq(task.systemKey, "break")),
		columns: { id: true },
	});
	if (!brk) throw new Error("Migration 0024 should have seeded the Break task");
	breakTaskId = brk.id;

	await db.insert(projectTask).values([
		{ organizationId: ORG, projectId: productProjectId, taskId: devTaskId },
		{ organizationId: ORG, projectId: internalProjectId, taskId: devTaskId },
	]);

	// The month's hour fund: 160h. Expected = fund - absence days x 8h.
	await db.insert(monthlyHourFund).values({
		organizationId: ORG,
		year: YEAR,
		month: MONTH,
		fundSeconds: 160 * H,
	});

	// CONTRACTOR is a contractor with no override → no Expected at all.
	await db.insert(memberTypeHistory).values({
		organizationId: ORG,
		userId: CONTRACTOR,
		type: "contractor",
		effectiveFrom: "2020-01-01",
	});
});

afterAll(async () => {
	await harness.close();
});

/** Wipe everything the tests write, so each one starts from the seeded fixture.
 *  Close records cascade to their rows. */
beforeEach(async () => {
	await db.delete(timeEntry).where(eq(timeEntry.organizationId, ORG));
	await db.delete(monthlyClose).where(eq(monthlyClose.organizationId, ORG));
});

/** An entry on the given day of the fixture month. */
const logTime = (
	userId: string,
	opts: {
		day: number;
		hours: number;
		projectId?: string | null;
		taskId?: string;
		overtime?: boolean;
	},
) =>
	db.insert(timeEntry).values({
		organizationId: ORG,
		userId,
		projectId: opts.projectId === undefined ? productProjectId : opts.projectId,
		taskId: opts.taskId ?? devTaskId,
		description: "work",
		date: `${YEAR}-${String(MONTH).padStart(2, "0")}-${String(opts.day).padStart(2, "0")}`,
		durationSeconds: opts.hours * H,
		overtime: opts.overtime ?? false,
	});

const sheetFor = (userId: string, projectId = productProjectId) =>
	closeService.getSheet(ctxFor(userId), {
		projectId,
		year: YEAR,
		month: MONTH,
	});

const rowFor = (sheet: CloseSheet, userId: string): CloseSheetRow => {
	const row = sheet.rows.find((r) => r.userId === userId);
	if (!row) throw new Error(`No sheet row for ${userId}`);
	return row;
};

/** The stored close row for a person on the product project, read straight off
 *  the table — the snapshots and `finalDerived` are not on the sheet. */
const storedRow = async (userId: string) => {
	const row = await db
		.select()
		.from(monthlyCloseRow)
		.innerJoin(monthlyClose, eq(monthlyCloseRow.closeId, monthlyClose.id))
		.where(
			and(
				eq(monthlyClose.projectId, productProjectId),
				eq(monthlyCloseRow.userId, userId),
			),
		);
	const first = row[0];
	if (!first) throw new Error(`No stored close row for ${userId}`);
	return first.monthly_close_row;
};

// ── The pure formulas ───────────────────────────────────────────────────────

describe("expectedSecondsFor", () => {
	const billable = { type: "billable" as const, expectedSecondsOverride: null };
	const contractor = {
		type: "contractor" as const,
		expectedSecondsOverride: null,
	};

	test("billable: fund minus absence days x 8h", () => {
		expect(expectedSecondsFor(billable, 160 * H, 2)).toBe(160 * H - 2 * DAY);
	});

	test("billable with no fund yet is null, never zero", () => {
		// Null is the "/" row of the old sheet. Coercing it to 0 would show every
		// person as 100% under an Expected that was never entered.
		expect(expectedSecondsFor(billable, null, 0)).toBeNull();
	});

	test("contractor without an override has no Expected even when a fund exists", () => {
		expect(expectedSecondsFor(contractor, 160 * H, 0)).toBeNull();
	});

	test("contractor with an override uses it and ignores the fund", () => {
		expect(
			expectedSecondsFor(
				{ type: "contractor", expectedSecondsOverride: 100 * H },
				160 * H,
				1,
			),
		).toBe(100 * H - DAY);
	});

	test("a billable override outranks the fund", () => {
		expect(
			expectedSecondsFor(
				{ type: "billable", expectedSecondsOverride: 80 * H },
				160 * H,
				0,
			),
		).toBe(80 * H);
	});

	test("floors at zero rather than going negative", () => {
		// A month of vacation longer than the fund is possible; a negative
		// Expected would make utilization nonsense.
		expect(expectedSecondsFor(billable, 8 * H, 5)).toBe(0);
	});

	test("rounds fractional absence days rather than truncating", () => {
		expect(expectedSecondsFor(billable, 160 * H, 0.5)).toBe(160 * H - DAY / 2);
	});
});

describe("effectiveAdjusted / effectiveFinal", () => {
	test("fall back down the chain", () => {
		expect(
			effectiveAdjusted({ adjustedSeconds: null, reportedSeconds: 10 }),
		).toBe(10);
		expect(effectiveAdjusted({ adjustedSeconds: 7, reportedSeconds: 10 })).toBe(
			7,
		);
		expect(
			effectiveFinal({
				finalSeconds: null,
				adjustedSeconds: null,
				reportedSeconds: 10,
			}),
		).toBe(10);
		expect(
			effectiveFinal({
				finalSeconds: null,
				adjustedSeconds: 7,
				reportedSeconds: 10,
			}),
		).toBe(7);
		expect(
			effectiveFinal({
				finalSeconds: 5,
				adjustedSeconds: 7,
				reportedSeconds: 10,
			}),
		).toBe(5);
	});

	test("an explicit zero is a real value, not a missing one", () => {
		// `??` rather than `||` is what makes this hold: a PM adjusting somebody
		// down to zero must not silently fall back to Reported.
		expect(effectiveAdjusted({ adjustedSeconds: 0, reportedSeconds: 10 })).toBe(
			0,
		);
		expect(
			effectiveFinal({
				finalSeconds: 0,
				adjustedSeconds: 7,
				reportedSeconds: 10,
			}),
		).toBe(0);
	});
});

// ── Access ──────────────────────────────────────────────────────────────────

describe("getSheet access", () => {
	test("a plain member cannot open the sheet", async () => {
		await expect(sheetFor(WORKER)).rejects.toThrow(AccessError);
	});

	test("someone with no assignment at all cannot open the sheet", async () => {
		await expect(sheetFor(DRIFTER)).rejects.toThrow(AccessError);
	});

	test("the project's PM can", async () => {
		const sheet = await sheetFor(PM);
		expect(sheet.projectId).toBe(productProjectId);
	});

	test("an org admin can, without being assigned to the project", async () => {
		const sheet = await sheetFor(ADMIN);
		expect(sheet.projectId).toBe(productProjectId);
	});

	test("only an admin may edit the Final column", async () => {
		expect((await sheetFor(PM)).canEditFinal).toBe(false);
		expect((await sheetFor(ADMIN)).canEditFinal).toBe(true);
	});
});

// ── Property 1: nobody falls off the sheet ──────────────────────────────────

describe("getSheet rows", () => {
	test("includes the project's active assignments even with no time logged", async () => {
		const sheet = await sheetFor(PM);
		const ids = sheet.rows.map((r) => r.userId).sort();
		expect(ids).toEqual([CONTRACTOR, PM, WORKER].sort());
	});

	// The billing-error case: DRIFTER is assigned to nothing, so an
	// assignments-only sheet would drop their hours entirely.
	test("includes an unassigned person who logged time on the project", async () => {
		await logTime(DRIFTER, { day: 3, hours: 5 });
		const sheet = await sheetFor(PM);
		expect(rowFor(sheet, DRIFTER).reportedSeconds).toBe(5 * H);
	});

	test("sums only this project's entries, in this month", async () => {
		await logTime(WORKER, { day: 3, hours: 4 });
		await logTime(WORKER, { day: 4, hours: 2 });
		// Another project, and another month — neither may count.
		await logTime(WORKER, { day: 5, hours: 8, projectId: internalProjectId });
		await db.insert(timeEntry).values({
			organizationId: ORG,
			userId: WORKER,
			projectId: productProjectId,
			taskId: devTaskId,
			description: "last month",
			date: `${YEAR}-02-28`,
			durationSeconds: 99 * H,
		});

		expect(rowFor(await sheetFor(PM), WORKER).reportedSeconds).toBe(6 * H);
	});

	test("carries the overtime slice separately from the total", async () => {
		await logTime(WORKER, { day: 3, hours: 6 });
		await logTime(WORKER, { day: 4, hours: 2, overtime: true });
		const row = rowFor(await sheetFor(PM), WORKER);
		expect(row.reportedSeconds).toBe(8 * H);
		expect(row.overtimeSeconds).toBe(2 * H);
	});

	test("is sorted by name", async () => {
		const sheet = await sheetFor(PM);
		const names = sheet.rows.map((r) => r.name);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
	});
});

describe("getSheet absence and Expected", () => {
	test("absence is counted org-wide, not per project", async () => {
		// Absence entries carry no project by definition, so they can only be
		// counted org-wide — and must show identically on every sheet the person
		// appears on.
		await logTime(WORKER, {
			day: 10,
			hours: 8,
			projectId: null,
			taskId: vacationTaskId,
		});
		await logTime(WORKER, {
			day: 11,
			hours: 8,
			projectId: null,
			taskId: vacationTaskId,
		});

		const row = rowFor(await sheetFor(PM), WORKER);
		expect(row.absenceDaysComputed).toBe(2);
		expect(row.expectedSeconds).toBe(160 * H - 2 * DAY);
	});

	test("a half day of absence counts as half a day", async () => {
		await logTime(WORKER, {
			day: 10,
			hours: 4,
			projectId: null,
			taskId: vacationTaskId,
		});
		expect(rowFor(await sheetFor(PM), WORKER).absenceDaysComputed).toBe(0.5);
	});

	test("a contractor gets no Expected even on a product team", async () => {
		expect(rowFor(await sheetFor(PM), CONTRACTOR).expectedSeconds).toBeNull();
	});

	test("non-product-team projects get the lean sheet", async () => {
		const sheet = await sheetFor(PM, internalProjectId);
		expect(sheet.showsExpected).toBe(false);
		for (const row of sheet.rows) expect(row.expectedSeconds).toBeNull();
	});

	test("the PM's absence override replaces the computed count for Expected", async () => {
		await logTime(WORKER, {
			day: 10,
			hours: 8,
			projectId: null,
			taskId: vacationTaskId,
		});
		await closeService.saveRow(ctxFor(PM), {
			projectId: productProjectId,
			year: YEAR,
			month: MONTH,
			userId: WORKER,
			absenceDaysOverride: 3,
		});

		const row = rowFor(await sheetFor(PM), WORKER);
		// The computed figure stays visible — divergence is the signal.
		expect(row.absenceDaysComputed).toBe(1);
		expect(row.absenceDaysOverride).toBe(3);
		expect(row.expectedSeconds).toBe(160 * H - 3 * DAY);
	});
});

describe("getSheet percentage columns", () => {
	test("are null rather than infinite when the base is zero", async () => {
		const row = rowFor(await sheetFor(PM), WORKER);
		expect(row.reportedSeconds).toBe(0);
		expect(row.adjustedVsReportedPct).toBeNull();
	});

	test("report the change from Reported to Adjusted", async () => {
		await logTime(WORKER, { day: 3, hours: 10 });
		await closeService.saveRow(ctxFor(PM), {
			projectId: productProjectId,
			year: YEAR,
			month: MONTH,
			userId: WORKER,
			adjustedSeconds: 8 * H,
		});
		expect(rowFor(await sheetFor(PM), WORKER).adjustedVsReportedPct).toBe(-20);
	});
});

// ── saveRow ─────────────────────────────────────────────────────────────────

describe("saveRow", () => {
	const save = (input: Partial<Parameters<typeof closeService.saveRow>[1]>) =>
		closeService.saveRow(ctxFor(PM), {
			projectId: productProjectId,
			year: YEAR,
			month: MONTH,
			userId: WORKER,
			...input,
		});

	test("a plain member cannot", async () => {
		await expect(
			closeService.saveRow(ctxFor(WORKER), {
				projectId: productProjectId,
				year: YEAR,
				month: MONTH,
				userId: WORKER,
				adjustedSeconds: 1 * H,
			}),
		).rejects.toThrow(AccessError);
	});

	// The undefined/null distinction the onConflictDoUpdate spread exists for:
	// omitting a field must leave it alone, while passing null must clear it.
	test("omitting a field leaves it alone; null clears it", async () => {
		await save({ adjustedSeconds: 5 * H, comment: "first pass" });
		await save({ comment: "second pass" });

		let row = rowFor(await sheetFor(PM), WORKER);
		expect(row.adjustedSeconds).toBe(5 * H);
		expect(row.comment).toBe("second pass");

		await save({ adjustedSeconds: null });
		row = rowFor(await sheetFor(PM), WORKER);
		expect(row.adjustedSeconds).toBeNull();
		expect(row.comment).toBe("second pass");
	});

	test("does not create a close record on read", async () => {
		// getSheet must never open state — an untouched month reads as Open with
		// no row in the table.
		await sheetFor(PM);
		const records = await db
			.select()
			.from(monthlyClose)
			.where(eq(monthlyClose.organizationId, ORG));
		expect(records).toHaveLength(0);
	});
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

const transition = { projectId: "", year: YEAR, month: MONTH };

describe("submit", () => {
	test("moves the sheet to submitted", async () => {
		await closeService.submit(ctxFor(PM), {
			...transition,
			projectId: productProjectId,
		});
		const sheet = await sheetFor(PM);
		expect(sheet.status).toBe("submitted");
		expect(sheet.submittedAt).not.toBeNull();
	});

	test("a plain member cannot", async () => {
		await expect(
			closeService.submit(ctxFor(WORKER), {
				...transition,
				projectId: productProjectId,
			}),
		).rejects.toThrow(AccessError);
	});

	// Submitting is a PM action and unfiled entries belong to individuals, so
	// the unfiled stop deliberately does NOT apply here — only to finalize.
	test("is allowed while somebody still has unfiled time", async () => {
		await logTime(WORKER, { day: 3, hours: 2, projectId: null });
		await closeService.submit(ctxFor(PM), {
			...transition,
			projectId: productProjectId,
		});
		expect((await sheetFor(PM)).status).toBe("submitted");
	});
});

// ── Property 3: finalize refuses unfiled time ───────────────────────────────

describe("finalize", () => {
	const finalize = (userId: string) =>
		closeService.finalize(ctxFor(userId), {
			...transition,
			projectId: productProjectId,
		});

	test("is admin-only — a PM cannot", async () => {
		await expect(finalize(PM)).rejects.toThrow(AccessError);
	});

	test("refuses while somebody has time filed against no project", async () => {
		await logTime(WORKER, { day: 3, hours: 2, projectId: null });
		await expect(finalize(ADMIN)).rejects.toThrow(
			/not filed against any project/,
		);
	});

	test("names the people holding the month up", async () => {
		await logTime(WORKER, { day: 3, hours: 2, projectId: null });
		await expect(finalize(ADMIN)).rejects.toThrow(/worker/);
	});

	// The close record is created and locked BEFORE the unfiled gate now, in the
	// same transaction, so the gate reads the month under the lock it is about
	// to write through. Refusing must therefore roll that record back: an empty
	// Open close on an untouched month reads as "somebody started this".
	test("a refused finalize leaves no close record behind", async () => {
		await logTime(WORKER, { day: 3, hours: 2, projectId: null });
		await expect(finalize(ADMIN)).rejects.toThrow(/not filed/);

		const records = await db
			.select()
			.from(monthlyClose)
			.where(eq(monthlyClose.organizationId, ORG));
		expect(records).toHaveLength(0);
	});

	// A Break has no project and never will — nobody bills a client for lunch —
	// so counting it as unfiled would block the close on something unfileable.
	test("a project-less Break does not count as unfiled", async () => {
		await logTime(WORKER, {
			day: 3,
			hours: 1,
			projectId: null,
			taskId: breakTaskId,
		});
		await expect(finalize(ADMIN)).resolves.toBeUndefined();
	});

	test("absence does not count as unfiled", async () => {
		await logTime(WORKER, {
			day: 3,
			hours: 8,
			projectId: null,
			taskId: vacationTaskId,
		});
		await expect(finalize(ADMIN)).resolves.toBeUndefined();
	});

	test("moves the sheet to finalized and locks Adjusted", async () => {
		await finalize(ADMIN);
		const sheet = await sheetFor(ADMIN);
		expect(sheet.status).toBe("finalized");
		expect(sheet.finalizedAt).not.toBeNull();
		expect(sheet.canEditAdjusted).toBe(false);
	});

	test("a finalized month refuses further PM edits", async () => {
		await finalize(ADMIN);
		await expect(
			closeService.saveRow(ctxFor(PM), {
				projectId: productProjectId,
				year: YEAR,
				month: MONTH,
				userId: WORKER,
				adjustedSeconds: 1 * H,
			}),
		).rejects.toThrow(/finalized/);
	});
});

// ── Property 2: finalize snapshots ──────────────────────────────────────────

describe("finalize snapshots", () => {
	test("freezes Reported, Expected and Overtime as they stood", async () => {
		await logTime(WORKER, { day: 3, hours: 6 });
		await logTime(WORKER, { day: 4, hours: 2, overtime: true });
		await closeService.finalize(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});

		const snapshot = await storedRow(WORKER);
		expect(snapshot.reportedAtFinalizeSeconds).toBe(8 * H);
		expect(snapshot.overtimeAtFinalizeSeconds).toBe(2 * H);
		expect(snapshot.expectedAtFinalizeSeconds).toBe(160 * H);
	});

	// The snapshot is only worth anything if it is written ONCE. Finalizing a
	// month that is already finalized used to re-run the whole pass and overwrite
	// all three columns with today's figures — so the baseline the variance report
	// compares Final against became the numbers it was supposed to be measured
	// away from, and every variance quietly read as zero. The sheet hides the
	// Finalize button once finalized, so this covers the paths that are not the
	// sheet: the assistant's `close_finalize` tool and any direct service caller.
	test("refuses to finalize a month that is already finalized", async () => {
		await logTime(WORKER, { day: 3, hours: 6 });
		await closeService.finalize(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});
		await logTime(WORKER, { day: 20, hours: 10 });

		await expect(
			closeService.finalize(ctxFor(ADMIN), {
				...transition,
				projectId: productProjectId,
			}),
		).rejects.toThrow(/finalized/);

		// The point: the original baseline survived the attempt.
		expect((await storedRow(WORKER)).reportedAtFinalizeSeconds).toBe(6 * H);
	});

	// Re-open is how a close is legitimately redone, and it must still work.
	test("re-opening allows a fresh finalize that re-snapshots", async () => {
		await logTime(WORKER, { day: 3, hours: 6 });
		await closeService.finalize(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});
		await logTime(WORKER, { day: 20, hours: 10 });

		await closeService.reopen(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});
		await closeService.finalize(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});

		expect((await storedRow(WORKER)).reportedAtFinalizeSeconds).toBe(16 * H);
	});

	// The reason the snapshot exists at all: entries stay editable afterwards.
	test("the snapshot does not move when entries change afterwards", async () => {
		await logTime(WORKER, { day: 3, hours: 6 });
		await closeService.finalize(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});
		await logTime(WORKER, { day: 20, hours: 10 });

		const sheet = await sheetFor(ADMIN);
		// Reported keeps moving, by design...
		expect(rowFor(sheet, WORKER).reportedSeconds).toBe(16 * H);
		// ...while what was frozen stays frozen.
		expect((await storedRow(WORKER)).reportedAtFinalizeSeconds).toBe(6 * H);
	});

	// Materialised rather than left to the null-fallback chain, so the invoiced
	// number is a stored fact.
	test("materialises the effective Final rather than leaving it null", async () => {
		await logTime(WORKER, { day: 3, hours: 6 });
		await closeService.finalize(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});
		expect((await storedRow(WORKER)).finalSeconds).toBe(6 * H);
	});

	test("an Adjusted value becomes the Final when the admin set none", async () => {
		await logTime(WORKER, { day: 3, hours: 10 });
		await closeService.saveRow(ctxFor(PM), {
			projectId: productProjectId,
			year: YEAR,
			month: MONTH,
			userId: WORKER,
			adjustedSeconds: 8 * H,
		});
		await closeService.finalize(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});
		expect((await storedRow(WORKER)).finalSeconds).toBe(8 * H);
	});

	test("an explicit Final outranks Adjusted", async () => {
		await logTime(WORKER, { day: 3, hours: 10 });
		await closeService.saveRow(ctxFor(PM), {
			projectId: productProjectId,
			year: YEAR,
			month: MONTH,
			userId: WORKER,
			adjustedSeconds: 8 * H,
		});
		await closeService.setFinal(ctxFor(ADMIN), {
			projectId: productProjectId,
			year: YEAR,
			month: MONTH,
			userId: WORKER,
			finalSeconds: 7 * H,
		});
		await closeService.finalize(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});
		expect((await storedRow(WORKER)).finalSeconds).toBe(7 * H);
	});
});

describe("setFinal", () => {
	test("is admin-only — a PM cannot", async () => {
		await expect(
			closeService.setFinal(ctxFor(PM), {
				projectId: productProjectId,
				year: YEAR,
				month: MONTH,
				userId: WORKER,
				finalSeconds: 1 * H,
			}),
		).rejects.toThrow(AccessError);
	});
});

describe("reopen", () => {
	test("a PM may re-open their own submission", async () => {
		await closeService.submit(ctxFor(PM), {
			...transition,
			projectId: productProjectId,
		});
		await closeService.reopen(ctxFor(PM), {
			...transition,
			projectId: productProjectId,
		});

		const sheet = await sheetFor(PM);
		expect(sheet.status).toBe("open");
		expect(sheet.submittedAt).toBeNull();
	});

	test("a PM may NOT re-open a finalized month", async () => {
		await closeService.finalize(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});
		await expect(
			closeService.reopen(ctxFor(PM), {
				...transition,
				projectId: productProjectId,
			}),
		).rejects.toThrow(AccessError);
	});

	test("an admin may", async () => {
		await closeService.finalize(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});
		await closeService.reopen(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});
		const sheet = await sheetFor(ADMIN);
		expect(sheet.status).toBe("open");
		expect(sheet.finalizedAt).toBeNull();
	});

	// Re-opening must not erase what was reported at the moment the month was
	// frozen, or the variance report loses the only record of it.
	test("leaves the finalization snapshots in place", async () => {
		await logTime(WORKER, { day: 3, hours: 6 });
		await closeService.finalize(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});
		await closeService.reopen(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});

		const rows = await db
			.select()
			.from(monthlyCloseRow)
			.innerJoin(monthlyClose, eq(monthlyCloseRow.closeId, monthlyClose.id))
			.where(
				and(
					eq(monthlyClose.projectId, productProjectId),
					eq(monthlyCloseRow.userId, WORKER),
				),
			);
		expect(rows[0]?.monthly_close_row.reportedAtFinalizeSeconds).toBe(6 * H);
	});

	test("is a no-op on a month that was never opened", async () => {
		await expect(
			closeService.reopen(ctxFor(PM), {
				...transition,
				projectId: productProjectId,
			}),
		).resolves.toBeUndefined();
	});
});

// ── overview ────────────────────────────────────────────────────────────────

describe("overview", () => {
	test("scopes to the caller's PM projects", async () => {
		const rows = await closeService.overview(ctxFor(PM), YEAR, MONTH);
		expect(rows.map((r) => r.projectId).sort()).toEqual(
			[productProjectId, internalProjectId].sort(),
		);
	});

	test("is empty for somebody who is PM of nothing", async () => {
		expect(await closeService.overview(ctxFor(WORKER), YEAR, MONTH)).toEqual(
			[],
		);
	});

	test("an admin sees every project", async () => {
		const rows = await closeService.overview(ctxFor(ADMIN), YEAR, MONTH);
		expect(rows).toHaveLength(2);
	});

	test("reports Open for a month nobody has touched", async () => {
		const rows = await closeService.overview(ctxFor(ADMIN), YEAR, MONTH);
		for (const row of rows) {
			expect(row.status).toBe("open");
			expect(row.finalSeconds).toBeNull();
		}
	});

	// Unfiled time has no project, so it must not be folded into a project total
	// — it used to land under an empty-string key and read as a real project.
	test("project totals exclude unfiled time", async () => {
		await logTime(WORKER, { day: 3, hours: 4 });
		await logTime(WORKER, { day: 4, hours: 5, projectId: null });

		const rows = await closeService.overview(ctxFor(ADMIN), YEAR, MONTH);
		const product = rows.find((r) => r.projectId === productProjectId);
		expect(product?.reportedSeconds).toBe(4 * H);
	});

	// Before finalize, only the rows an admin typed carry a stored Final, so a
	// sum over them is a fraction of the sheet dressed as its invoiced total.
	test("reports Final only once the month is finalized", async () => {
		await logTime(WORKER, { day: 3, hours: 10 });
		await closeService.setFinal(ctxFor(ADMIN), {
			projectId: productProjectId,
			year: YEAR,
			month: MONTH,
			userId: WORKER,
			finalSeconds: 7 * H,
		});

		const productOf = async () =>
			(await closeService.overview(ctxFor(ADMIN), YEAR, MONTH)).find(
				(r) => r.projectId === productProjectId,
			);
		expect((await productOf())?.finalSeconds).toBeNull();

		await closeService.finalize(ctxFor(ADMIN), {
			...transition,
			projectId: productProjectId,
		});
		// WORKER's typed 7h; PM and CONTRACTOR materialize to their zero Reported.
		expect((await productOf())?.finalSeconds).toBe(7 * H);
	});
});

// ── Re-open then finalize ───────────────────────────────────────────────────

describe("re-open then finalize", () => {
	const at = { projectId: "", year: YEAR, month: MONTH };
	const finalize = () =>
		closeService.finalize(ctxFor(ADMIN), {
			...at,
			projectId: productProjectId,
		});
	const reopen = () =>
		closeService.reopen(ctxFor(ADMIN), { ...at, projectId: productProjectId });
	const adjust = (seconds: number) =>
		closeService.saveRow(ctxFor(PM), {
			...at,
			projectId: productProjectId,
			userId: WORKER,
			adjustedSeconds: seconds,
		});

	// The regression: finalize materialized Adjusted into the Final column, and
	// re-open left it there — so the second finalize read it back as if an admin
	// had typed it, and the correction the month was re-opened for never reached
	// the invoice.
	test("re-derives a Final that finalize filled in, from the Adjusted saved after re-open", async () => {
		await logTime(WORKER, { day: 3, hours: 10 });
		await finalize();
		expect((await storedRow(WORKER)).finalSeconds).toBe(10 * H);

		await reopen();
		// Back on the fallback chain: the sheet shows Adjusted again, not a Final.
		expect(rowFor(await sheetFor(PM), WORKER).finalSeconds).toBeNull();

		await adjust(16 * H);
		await finalize();
		expect((await storedRow(WORKER)).finalSeconds).toBe(16 * H);
	});

	test("keeps a Final an admin typed across re-open and re-finalize", async () => {
		await logTime(WORKER, { day: 3, hours: 10 });
		await closeService.setFinal(ctxFor(ADMIN), {
			...at,
			projectId: productProjectId,
			userId: WORKER,
			finalSeconds: 7 * H,
		});
		await finalize();
		await reopen();
		await adjust(16 * H);
		await finalize();

		const stored = await storedRow(WORKER);
		expect(stored.finalSeconds).toBe(7 * H);
		expect(stored.finalDerived).toBe(false);
	});

	// A Final corrected by hand on a finalized month is a decision too, even
	// though the row it lands on was first filled in by finalize.
	test("a Final typed after finalize survives the next re-open", async () => {
		await logTime(WORKER, { day: 3, hours: 10 });
		await finalize();
		await closeService.setFinal(ctxFor(ADMIN), {
			...at,
			projectId: productProjectId,
			userId: WORKER,
			finalSeconds: 9 * H,
		});
		await reopen();
		expect((await storedRow(WORKER)).finalSeconds).toBe(9 * H);
	});
});

// ── Membership ──────────────────────────────────────────────────────────────

describe("the person a row is about must be in the org", () => {
	const at = { projectId: "", year: YEAR, month: MONTH };

	test("saveRow refuses a non-member", async () => {
		await expect(
			closeService.saveRow(ctxFor(PM), {
				...at,
				projectId: productProjectId,
				userId: OUTSIDER,
				adjustedSeconds: 1 * H,
			}),
		).rejects.toThrow(/not a member/);
	});

	test("setFinal refuses a non-member", async () => {
		await expect(
			closeService.setFinal(ctxFor(ADMIN), {
				...at,
				projectId: productProjectId,
				userId: OUTSIDER,
				finalSeconds: 1 * H,
			}),
		).rejects.toThrow(/not a member/);
	});

	// A stored row the old write paths let through must not put a stranger's
	// name and email on the sheet.
	test("the sheet does not surface a non-member's stored row", async () => {
		const [close] = await db
			.insert(monthlyClose)
			.values({
				organizationId: ORG,
				projectId: productProjectId,
				year: YEAR,
				month: MONTH,
			})
			.returning();
		if (!close) throw new Error("Failed to seed a close");
		await db.insert(monthlyCloseRow).values({
			organizationId: ORG,
			closeId: close.id,
			userId: OUTSIDER,
			adjustedSeconds: 3 * H,
		});

		const ids = (await sheetFor(ADMIN)).rows.map((r) => r.userId);
		expect(ids).not.toContain(OUTSIDER);
	});

	// ...while time actually logged on the project stays on it, member or not:
	// somebody who has since left still did the work being invoiced.
	test("the sheet keeps reported time from somebody no longer a member", async () => {
		await logTime(OUTSIDER, { day: 3, hours: 2 });
		expect(rowFor(await sheetFor(ADMIN), OUTSIDER).reportedSeconds).toBe(2 * H);
	});
});

// ── A Final set on a finalized month ────────────────────────────────────────

describe("setFinal on a finalized month", () => {
	const at = { projectId: "", year: YEAR, month: MONTH };

	// DRIFTER is on nothing when the month is frozen, so finalize writes no row
	// for them. Their row used to arrive with a null Reported-at-finalize, which
	// the variance report sums as zero — the whole Final read as variance.
	test("snapshots a person new to the sheet as they stand now", async () => {
		await closeService.finalize(ctxFor(ADMIN), {
			...at,
			projectId: productProjectId,
		});
		await logTime(DRIFTER, { day: 20, hours: 5 });
		await closeService.setFinal(ctxFor(ADMIN), {
			...at,
			projectId: productProjectId,
			userId: DRIFTER,
			finalSeconds: 5 * H,
		});

		const stored = await storedRow(DRIFTER);
		expect(stored.reportedAtFinalizeSeconds).toBe(5 * H);
		expect(stored.overtimeAtFinalizeSeconds).toBe(0);
		expect(stored.expectedAtFinalizeSeconds).toBe(160 * H);
	});

	test("does not move the snapshot of somebody finalize already froze", async () => {
		await logTime(WORKER, { day: 3, hours: 6 });
		await closeService.finalize(ctxFor(ADMIN), {
			...at,
			projectId: productProjectId,
		});
		await logTime(WORKER, { day: 20, hours: 10 });
		await closeService.setFinal(ctxFor(ADMIN), {
			...at,
			projectId: productProjectId,
			userId: WORKER,
			finalSeconds: 20 * H,
		});

		expect((await storedRow(WORKER)).reportedAtFinalizeSeconds).toBe(6 * H);
	});
});
