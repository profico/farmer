import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { monthlyClose, monthlyCloseRow } from "../db/schema/close";
import { project, projectMember, task, timeEntry } from "../db/schema/domain";
import { monthBounds } from "../lib/time";
import type {
	CloseSheetInput,
	CloseTransitionInput,
	SaveCloseRowInput,
	SetCloseRowFinalInput,
} from "../schema/close";
import { ctxAccess } from "./context";
import { assertProjectInOrg } from "./guards";
import { hourFundService, WORKING_DAY_SECONDS } from "./hour-fund.service";
import { membersService, type ResolvedMemberType } from "./members.service";
import type { Ctx } from "./types";
import { unfiledByUser } from "./unfiled";

export type CloseStatus = "open" | "submitted" | "finalized";

export type CloseSheetRow = {
	userId: string;
	name: string;
	email: string;
	memberType: ResolvedMemberType["type"];
	/** Live sum of this person's entries on this project for the month. The
	 *  "Harvest" column of the old sheet — read-only, and it keeps moving after
	 *  finalization because entries stay editable (PRD decision 2). */
	reportedSeconds: number;
	/** The PM's reconciled number. Null until touched, displaying as Reported. */
	adjustedSeconds: number | null;
	/** Admin-only. The number that gets invoiced. Null until touched, displaying
	 *  as Adjusted. */
	finalSeconds: number | null;
	/** fund - absence days x 8. Null when there is no fund for the month, or the
	 *  person has no fund at all (a contractor without an explicit override), or
	 *  the project type doesn't carry Expected. */
	expectedSeconds: number | null;
	overtimeSeconds: number;
	/** This person's time for the month that carries no project at all — synced
	 *  meetings and fill blocks they haven't filed yet. Org-wide, not per project,
	 *  because an unfiled entry has no project to be counted against: some of it
	 *  may belong on this sheet and there is no way to know which until they file
	 *  it. Surfaced so the PM can chase before finalization, which `finalize`
	 *  refuses while this is non-zero. */
	unfiledSeconds: number;
	/** Computed from the person's Vacation/Sick entries... */
	absenceDaysComputed: number;
	/** ...and the PM's override, which lives on the sheet ONLY and never writes
	 *  back to entries. Divergence is a signal that the person forgot to log
	 *  absence, not a data error (PRD decision 3). */
	absenceDaysOverride: number | null;
	comment: string | null;
	/** Mirrors the two % columns of the current COO sheet. */
	adjustedVsReportedPct: number | null;
	finalVsAdjustedPct: number | null;
};

export type CloseSheet = {
	projectId: string;
	projectName: string;
	projectType: string;
	clientName: string;
	year: number;
	month: number;
	status: CloseStatus;
	/** Product Team projects get the full sheet (Expected + absence columns);
	 *  every other type gets the lean one. "Did this person deliver their full
	 *  available month" is only the invoicing question for Product Teams. */
	showsExpected: boolean;
	fundSeconds: number | null;
	submittedAt: Date | null;
	finalizedAt: Date | null;
	canEditAdjusted: boolean;
	canEditFinal: boolean;
	rows: CloseSheetRow[];
};

const pctChange = (from: number, to: number): number | null => {
	if (from === 0) return null;
	return Math.round(((to - from) / from) * 1000) / 10;
};

/** The effective Adjusted for a row: the PM's number, else Reported. */
export const effectiveAdjusted = (row: {
	adjustedSeconds: number | null;
	reportedSeconds: number;
}) => row.adjustedSeconds ?? row.reportedSeconds;

/** The effective Final: the Admin's number, else Adjusted. This is the value
 *  every downstream report (utilization, variance, not-on-invoice) reads. */
export const effectiveFinal = (row: {
	finalSeconds: number | null;
	adjustedSeconds: number | null;
	reportedSeconds: number;
}) => row.finalSeconds ?? effectiveAdjusted(row);

/**
 * Per-person worked totals on one project for a month, plus the overtime slice.
 * Absence is excluded here because absence entries carry no project — they are
 * counted org-wide by `absenceDaysByUser` below.
 */
const reportedByUser = async (
	ctx: Ctx,
	projectId: string,
	from: string,
	to: string,
) => {
	const rows = await db
		.select({
			userId: timeEntry.userId,
			total: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
			overtime: sql<string>`coalesce(sum(case when ${timeEntry.overtime} then ${timeEntry.durationSeconds} else 0 end), 0)`,
		})
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.projectId, projectId),
				gte(timeEntry.date, from),
				lte(timeEntry.date, to),
			),
		)
		.groupBy(timeEntry.userId);

	return new Map(
		rows.map((r) => [
			r.userId,
			{ reported: Number(r.total), overtime: Number(r.overtime) },
		]),
	);
};

/**
 * Absence days per person for the month, derived from their Vacation/Sick
 * entries across the whole org (absence has no project, so it is the same number
 * on every close sheet the person appears on — which is exactly the pain the
 * self-logged design removes: PMs no longer restate vacation per project row).
 */
export const absenceDaysByUser = async (
	ctx: Ctx,
	from: string,
	to: string,
): Promise<Map<string, number>> => {
	const rows = await db
		.select({
			userId: timeEntry.userId,
			total: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
		})
		.from(timeEntry)
		.innerJoin(task, eq(timeEntry.taskId, task.id))
		.where(
			and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(task.isAbsence, true),
				gte(timeEntry.date, from),
				lte(timeEntry.date, to),
			),
		)
		.groupBy(timeEntry.userId);

	return new Map(
		rows.map((r) => [r.userId, Number(r.total) / WORKING_DAY_SECONDS]),
	);
};

/**
 * Expected hours for one person in a month:
 *
 *     Expected = monthly fund - (absence days x 8)
 *
 * Null — meaning "no Expected math applies", the "/" rows of the old sheet —
 * when the person is a contractor without an explicit override, or the admin
 * hasn't entered the month's fund yet. Never silently defaults: without a fund
 * there is no number to reconcile against, and inventing one would be worse than
 * showing a blank.
 */
export const expectedSecondsFor = (
	memberType: ResolvedMemberType,
	fundSeconds: number | null,
	absenceDays: number,
): number | null => {
	const base =
		memberType.type === "contractor"
			? memberType.expectedSecondsOverride
			: (memberType.expectedSecondsOverride ?? fundSeconds);
	if (base == null) return null;
	return Math.max(0, base - Math.round(absenceDays * WORKING_DAY_SECONDS));
};

const loadCloseRecord = async (
	ctx: Ctx,
	projectId: string,
	year: number,
	month: number,
) =>
	db.query.monthlyClose.findFirst({
		where: and(
			eq(monthlyClose.organizationId, ctx.organizationId),
			eq(monthlyClose.projectId, projectId),
			eq(monthlyClose.year, year),
			eq(monthlyClose.month, month),
		),
		with: { rows: true },
	});

/** Get-or-create the close record. Reads never call this — a read must not
 *  create state — so a month nobody has touched simply reports as Open. */
const ensureClose = async (
	ctx: Ctx,
	projectId: string,
	year: number,
	month: number,
): Promise<string> => {
	const [created] = await db
		.insert(monthlyClose)
		.values({
			organizationId: ctx.organizationId,
			projectId,
			year,
			month,
		})
		.onConflictDoNothing({
			target: [
				monthlyClose.organizationId,
				monthlyClose.projectId,
				monthlyClose.year,
				monthlyClose.month,
			],
		})
		.returning({ id: monthlyClose.id });
	if (created) return created.id;

	const existing = await loadCloseRecord(ctx, projectId, year, month);
	if (!existing) throw new Error("Failed to open the close sheet");
	return existing.id;
};

const assertNotFinalized = (status: CloseStatus) => {
	if (status === "finalized") {
		throw new Error("This month is finalized. Re-open it to make changes.");
	}
};

export const closeService = {
	/**
	 * The close sheet for one project/month. Rows come from the project's active
	 * assignments, UNIONed with anyone who actually logged time on the project
	 * that month — an unassigned contributor's hours must never silently fall off
	 * the sheet, since the sheet is what gets invoiced.
	 */
	getSheet: async (ctx: Ctx, input: CloseSheetInput): Promise<CloseSheet> => {
		const access = await ctxAccess(ctx);
		access.assertCanCloseProject(input.projectId);
		await assertProjectInOrg(ctx, input.projectId);

		const { from, to } = monthBounds(input.year, input.month);

		const [proj, record, reported, absence, fundSeconds, types, unfiled] =
			await Promise.all([
				db.query.project.findFirst({
					where: eq(project.id, input.projectId),
					with: { client: true },
				}),
				loadCloseRecord(ctx, input.projectId, input.year, input.month),
				reportedByUser(ctx, input.projectId, from, to),
				absenceDaysByUser(ctx, from, to),
				hourFundService.get(ctx, input.year, input.month),
				membersService.typesForMonth(ctx, input.year, input.month),
				unfiledByUser(ctx, { from, to }),
			]);
		if (!proj) throw new Error("Project not found");

		const assignments = await db
			.select({ userId: projectMember.userId })
			.from(projectMember)
			.where(
				and(
					eq(projectMember.organizationId, ctx.organizationId),
					eq(projectMember.projectId, input.projectId),
					eq(projectMember.active, true),
				),
			);

		const userIds = [
			...new Set([
				...assignments.map((a) => a.userId),
				...reported.keys(),
				...(record?.rows ?? []).map((r) => r.userId),
			]),
		];

		const people =
			userIds.length > 0
				? await db
						.select({ id: user.id, name: user.name, email: user.email })
						.from(user)
						.where(inArray(user.id, userIds))
				: [];
		const peopleById = new Map(people.map((p) => [p.id, p]));
		const storedByUser = new Map(
			(record?.rows ?? []).map((r) => [r.userId, r]),
		);

		const status: CloseStatus = record?.status ?? "open";
		// Only Product Team projects carry Expected/absence columns; every other
		// type gets the lean sheet, which keeps the PM's job small.
		const showsExpected = proj.type === "product_team";

		const rows: CloseSheetRow[] = userIds
			.map((userId) => {
				const person = peopleById.get(userId);
				const stored = storedByUser.get(userId);
				const totals = reported.get(userId) ?? { reported: 0, overtime: 0 };
				const memberType = types.get(userId) ?? {
					type: "billable" as const,
					expectedSecondsOverride: null,
				};

				const absenceDaysComputed =
					Math.round((absence.get(userId) ?? 0) * 100) / 100;
				const absenceDays = stored?.absenceDaysOverride ?? absenceDaysComputed;

				const adjusted = stored?.adjustedSeconds ?? null;
				const final = stored?.finalSeconds ?? null;
				const effAdjusted = adjusted ?? totals.reported;
				const effFinal = final ?? effAdjusted;

				return {
					userId,
					name: person?.name ?? "Unknown",
					email: person?.email ?? "",
					memberType: memberType.type,
					reportedSeconds: totals.reported,
					adjustedSeconds: adjusted,
					finalSeconds: final,
					// Contractor rows never show Expected/absence math regardless of
					// project type, unless an explicit expected value is set on them.
					expectedSeconds: showsExpected
						? expectedSecondsFor(memberType, fundSeconds, absenceDays)
						: null,
					overtimeSeconds: totals.overtime,
					unfiledSeconds: unfiled.get(userId)?.seconds ?? 0,
					absenceDaysComputed,
					absenceDaysOverride: stored?.absenceDaysOverride ?? null,
					comment: stored?.comment ?? null,
					adjustedVsReportedPct: pctChange(totals.reported, effAdjusted),
					finalVsAdjustedPct: pctChange(effAdjusted, effFinal),
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));

		return {
			projectId: proj.id,
			projectName: proj.name,
			projectType: proj.type,
			clientName: proj.client.name,
			year: input.year,
			month: input.month,
			status,
			showsExpected,
			fundSeconds,
			submittedAt: record?.submittedAt ?? null,
			finalizedAt: record?.finalizedAt ?? null,
			canEditAdjusted: status !== "finalized",
			canEditFinal: access.isAdmin,
			rows,
		};
	},

	/** PM edits: Adjusted, the absence-day override, and the comment. */
	saveRow: async (ctx: Ctx, input: SaveCloseRowInput) => {
		const access = await ctxAccess(ctx);
		access.assertCanCloseProject(input.projectId);
		await assertProjectInOrg(ctx, input.projectId);

		const record = await loadCloseRecord(
			ctx,
			input.projectId,
			input.year,
			input.month,
		);
		if (record) assertNotFinalized(record.status);

		const closeId = await ensureClose(
			ctx,
			input.projectId,
			input.year,
			input.month,
		);

		await db
			.insert(monthlyCloseRow)
			.values({
				organizationId: ctx.organizationId,
				closeId,
				userId: input.userId,
				adjustedSeconds: input.adjustedSeconds ?? null,
				absenceDaysOverride: input.absenceDaysOverride ?? null,
				comment: input.comment ?? null,
			})
			.onConflictDoUpdate({
				target: [monthlyCloseRow.closeId, monthlyCloseRow.userId],
				set: {
					// `undefined` means "leave alone", `null` means "clear the override
					// and fall back to the computed default" — the two are distinct here
					// and drizzle's .set() skipping `undefined` is what makes that work.
					...(input.adjustedSeconds !== undefined
						? { adjustedSeconds: input.adjustedSeconds }
						: {}),
					...(input.absenceDaysOverride !== undefined
						? { absenceDaysOverride: input.absenceDaysOverride }
						: {}),
					...(input.comment !== undefined ? { comment: input.comment } : {}),
					updatedAt: new Date(),
				},
			});
	},

	/** Admin-only: the Final column, the number that gets invoiced. */
	setFinal: async (ctx: Ctx, input: SetCloseRowFinalInput) => {
		const access = await ctxAccess(ctx);
		access.assertAdmin();
		await assertProjectInOrg(ctx, input.projectId);

		const closeId = await ensureClose(
			ctx,
			input.projectId,
			input.year,
			input.month,
		);

		await db
			.insert(monthlyCloseRow)
			.values({
				organizationId: ctx.organizationId,
				closeId,
				userId: input.userId,
				finalSeconds: input.finalSeconds,
			})
			.onConflictDoUpdate({
				target: [monthlyCloseRow.closeId, monthlyCloseRow.userId],
				set: { finalSeconds: input.finalSeconds, updatedAt: new Date() },
			});
	},

	// ── Lifecycle (PRD 5.2) ───────────────────────────────────────────────────
	//   Open -> PM Submitted -> Finalized
	// A PM may re-open and re-submit freely BEFORE finalization. An Admin may
	// finalize even if the PM never submitted (PM on vacation), and may re-open a
	// finalized month.

	submit: async (ctx: Ctx, input: CloseTransitionInput) => {
		const access = await ctxAccess(ctx);
		access.assertCanCloseProject(input.projectId);
		await assertProjectInOrg(ctx, input.projectId);

		const record = await loadCloseRecord(
			ctx,
			input.projectId,
			input.year,
			input.month,
		);
		if (record) assertNotFinalized(record.status);
		const closeId = await ensureClose(
			ctx,
			input.projectId,
			input.year,
			input.month,
		);

		await db
			.update(monthlyClose)
			.set({
				status: "submitted",
				submittedAt: new Date(),
				submittedByUserId: ctx.userId,
				updatedAt: new Date(),
			})
			.where(eq(monthlyClose.id, closeId));
	},

	reopen: async (ctx: Ctx, input: CloseTransitionInput) => {
		const access = await ctxAccess(ctx);
		access.assertCanCloseProject(input.projectId);

		const record = await loadCloseRecord(
			ctx,
			input.projectId,
			input.year,
			input.month,
		);
		if (!record) return;
		// Only an Admin can re-open a FINALIZED month; a PM may re-open their own
		// submission freely.
		if (record.status === "finalized") access.assertAdmin();

		await db
			.update(monthlyClose)
			.set({
				status: "open",
				submittedAt: null,
				submittedByUserId: null,
				finalizedAt: null,
				finalizedByUserId: null,
				updatedAt: new Date(),
			})
			.where(eq(monthlyClose.id, record.id));
		// The finalize snapshots are deliberately LEFT IN PLACE: re-opening must not
		// erase what was reported at the moment the month was frozen, or the
		// variance report loses the only record of it.
	},

	/**
	 * Admin finalize. Freezes the Final values by definition, and snapshots
	 * Reported / Expected / Overtime as they stand right now.
	 *
	 * The snapshot is the whole reason report 6.4 works: entries stay editable
	 * forever, including in finalized months, so a live-recomputed Reported would
	 * drift away from the Final it was compared against and the variance would
	 * quietly become meaningless.
	 */
	finalize: async (ctx: Ctx, input: CloseTransitionInput) => {
		const access = await ctxAccess(ctx);
		access.assertAdmin();
		await assertProjectInOrg(ctx, input.projectId);

		const sheet = await closeService.getSheet(ctx, input);

		// Refuse to freeze a month that still has unattributed time. Finalization is
		// the irreversible step and it snapshots Reported — if someone files their
		// meetings next week, that time lands on a project whose month is already
		// closed against a number that predates it, and report 6.4's variance
		// silently compares against the wrong baseline.
		//
		// Deliberately NOT enforced on `submit`: submitting is a PM action, unfiled
		// entries belong to individuals, and only the person themselves can file
		// their own time — blocking the PM would leave them stuck on something they
		// have no way to fix. They get the per-row warning on the sheet to chase
		// with, and the hard stop lands on the admin, who has org-wide reach.
		const holdouts = sheet.rows.filter((r) => r.unfiledSeconds > 0);
		if (holdouts.length > 0) {
			const names = holdouts.map((r) => r.name).join(", ");
			throw new Error(
				`Cannot finalize: ${names} ${holdouts.length === 1 ? "has" : "have"} time this month not filed against any project. It must be filed or deleted first.`,
			);
		}

		const closeId = await ensureClose(
			ctx,
			input.projectId,
			input.year,
			input.month,
		);

		await db.transaction(async (tx) => {
			for (const row of sheet.rows) {
				await tx
					.insert(monthlyCloseRow)
					.values({
						organizationId: ctx.organizationId,
						closeId,
						userId: row.userId,
						adjustedSeconds: row.adjustedSeconds,
						// Materialize the effective Final so the invoiced number is a
						// stored fact, not something re-derived from a chain of fallbacks.
						finalSeconds: effectiveFinal(row),
						absenceDaysOverride: row.absenceDaysOverride,
						comment: row.comment,
						reportedAtFinalizeSeconds: row.reportedSeconds,
						expectedAtFinalizeSeconds: row.expectedSeconds,
						overtimeAtFinalizeSeconds: row.overtimeSeconds,
					})
					.onConflictDoUpdate({
						target: [monthlyCloseRow.closeId, monthlyCloseRow.userId],
						set: {
							finalSeconds: effectiveFinal(row),
							reportedAtFinalizeSeconds: row.reportedSeconds,
							expectedAtFinalizeSeconds: row.expectedSeconds,
							overtimeAtFinalizeSeconds: row.overtimeSeconds,
							updatedAt: new Date(),
						},
					});
			}

			await tx
				.update(monthlyClose)
				.set({
					status: "finalized",
					finalizedAt: new Date(),
					finalizedByUserId: ctx.userId,
					updatedAt: new Date(),
				})
				.where(eq(monthlyClose.id, closeId));
		});
	},

	/**
	 * Every project for a month with its close state and totals — the Admin's
	 * working surface during close season and the reading surface afterwards. The
	 * submitted queue ("what is waiting for me") is just this, filtered.
	 */
	overview: async (ctx: Ctx, year: number, month: number) => {
		const access = await ctxAccess(ctx);
		const scope = access.scopeFor("pm");
		if (scope !== null && scope.length === 0) return [];

		const { from, to } = monthBounds(year, month);

		const projects = await db.query.project.findMany({
			where: and(
				eq(project.organizationId, ctx.organizationId),
				scope ? inArray(project.id, scope) : undefined,
			),
			with: { client: true },
		});
		if (projects.length === 0) return [];
		const projectIds = projects.map((p) => p.id);

		const [records, reportedRows, finalRows] = await Promise.all([
			db.query.monthlyClose.findMany({
				where: and(
					eq(monthlyClose.organizationId, ctx.organizationId),
					eq(monthlyClose.year, year),
					eq(monthlyClose.month, month),
					inArray(monthlyClose.projectId, projectIds),
				),
			}),
			db
				.select({
					projectId: timeEntry.projectId,
					total: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
				})
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.organizationId, ctx.organizationId),
						inArray(timeEntry.projectId, projectIds),
						gte(timeEntry.date, from),
						lte(timeEntry.date, to),
					),
				)
				.groupBy(timeEntry.projectId),
			db
				.select({
					projectId: monthlyClose.projectId,
					total: sql<string>`coalesce(sum(${monthlyCloseRow.finalSeconds}), 0)`,
				})
				.from(monthlyCloseRow)
				.innerJoin(monthlyClose, eq(monthlyCloseRow.closeId, monthlyClose.id))
				.where(
					and(
						eq(monthlyClose.organizationId, ctx.organizationId),
						eq(monthlyClose.year, year),
						eq(monthlyClose.month, month),
						inArray(monthlyClose.projectId, projectIds),
						isNotNull(monthlyCloseRow.finalSeconds),
					),
				)
				.groupBy(monthlyClose.projectId),
		]);

		const recordByProject = new Map(records.map((r) => [r.projectId, r]));
		const reportedByProject = new Map(
			reportedRows.map((r) => [r.projectId ?? "", Number(r.total)]),
		);
		const finalByProject = new Map(
			finalRows.map((r) => [r.projectId, Number(r.total)]),
		);

		return projects
			.map((p) => {
				const record = recordByProject.get(p.id);
				return {
					projectId: p.id,
					projectName: p.name,
					projectType: p.type,
					projectStatus: p.status,
					clientName: p.client.name,
					status: (record?.status ?? "open") as CloseStatus,
					submittedAt: record?.submittedAt ?? null,
					finalizedAt: record?.finalizedAt ?? null,
					reportedSeconds: reportedByProject.get(p.id) ?? 0,
					finalSeconds: finalByProject.get(p.id) ?? null,
				};
			})
			.sort(
				(a, b) =>
					a.clientName.localeCompare(b.clientName) ||
					a.projectName.localeCompare(b.projectName),
			);
	},
};
