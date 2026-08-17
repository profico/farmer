import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	lte,
	or,
	sql,
} from "drizzle-orm";
import { db } from "../db";
import { member, user } from "../db/schema/auth";
import { monthlyClose, monthlyCloseRow } from "../db/schema/close";
import { client, project, task, timeEntry } from "../db/schema/domain";
import { trailingMonths } from "../lib/report-period";
import { monthBounds } from "../lib/time";
import { rollUpUtilization, utilizationPctOf } from "../lib/utilization";
import type {
	AbsenceReportInput,
	MonthReportInput,
	TimeReportDetailInput,
	TimeReportSummaryInput,
} from "../schema/reports";
import { type Access, AccessError } from "./access.service";
import {
	absenceDaysByUserPerMonth,
	effectiveFinal,
	expectedSecondsFor,
} from "./close.service";
import { ctxAccess, requireAdmin } from "./context";
import { hourFundService, WORKING_DAY_SECONDS } from "./hour-fund.service";
import { membersService, type ResolvedMemberType } from "./members.service";
import type { Ctx } from "./types";
import { unfiledTotals } from "./unfiled";

// ── Scoping ────────────────────────────────────────────────────────────────
// Admin sees everything. PM and Team Lead see the report scoped to THEIR
// projects, and on the Teammates tab only people's hours within those shared
// projects — never a person's company-wide total, or a TL on one project could
// learn what people do for other clients. Members have no access at all.

const reportScope = async (
	ctx: Ctx,
): Promise<{ access: Access; projectIds: string[] | null }> => {
	const access = await ctxAccess(ctx);
	const projectIds = access.scopeFor("team_lead");
	if (projectIds !== null && projectIds.length === 0) {
		throw new AccessError("You do not have access to reports");
	}
	return { access, projectIds };
};

// The Time Report covers PROJECT time. Absence entries carry no project and no
// client, so they'd have nothing to group under; they are reported separately by
// the Absence report (6.3), which is the only place they belong.
//
// UNFILED entries — synced meetings and fill blocks not yet attributed to a
// project — are excluded by the same `isNotNull` and for the same reason: there
// is no client or project to file them under, and inventing an "Unfiled" client
// would put a fake row in a report whose whole shape is real clients. They are
// not dropped silently any more, though: `timeSummary` returns `unfiledSeconds`
// alongside the rows so the screen can say how much time is missing from the
// total instead of the number just being quietly short.
const projectTimeWhere = (
	ctx: Ctx,
	input: {
		from: string;
		to: string;
		clientId?: string;
		projectId?: string;
		taskId?: string;
		userId?: string;
	},
	scope: string[] | null,
) =>
	and(
		eq(timeEntry.organizationId, ctx.organizationId),
		isNotNull(timeEntry.projectId),
		gte(timeEntry.date, input.from),
		lte(timeEntry.date, input.to),
		scope ? inArray(timeEntry.projectId, scope) : undefined,
		input.projectId ? eq(timeEntry.projectId, input.projectId) : undefined,
		input.clientId ? eq(project.clientId, input.clientId) : undefined,
		input.taskId ? eq(timeEntry.taskId, input.taskId) : undefined,
		input.userId ? eq(timeEntry.userId, input.userId) : undefined,
	);

export type TimeReportRow = {
	id: string;
	name: string;
	secondsTotal: number;
};

/** How many entry rows a single detail response may carry.
 *
 *  Large enough that no ordinary drill-down ever meets it (a month of one
 *  project is a few hundred), small enough that the pathological request — a
 *  year, org-wide, unfiltered — stays a response rather than an incident. When
 *  it bites, `truncated` says so and the totals stay whole. */
const MAX_DETAIL_ROWS = 5000;

export type TimeReportDetail = {
	rows: TimeReportDetailRow[];
	/** Rows matching the filters, whether or not they all came back. */
	totalRows: number;
	/** Summed across ALL matching rows, not just the ones returned. */
	totalSeconds: number;
	truncated: boolean;
};

export type TimeReportDetailRow = {
	id: string;
	date: string;
	clientName: string;
	projectName: string;
	taskName: string;
	description: string;
	userName: string;
	overtime: boolean;
	durationSeconds: number;
};

export const reportsService = {
	/**
	 * Time Report level 1 (PRD 6.1) — a deliberate 1:1 structural replica of
	 * Harvest's most-used screen, minus every money concept. Tabs are Clients /
	 * Projects / Teammates; there is no Tasks tab (grouping by task adds no value
	 * for how these reports are read).
	 */
	timeSummary: async (
		ctx: Ctx,
		input: TimeReportSummaryInput,
	): Promise<{
		rows: TimeReportRow[];
		totalSeconds: number;
		unfiledSeconds: number;
	}> => {
		const { projectIds } = await reportScope(ctx);
		const where = projectTimeWhere(ctx, input, projectIds);

		const grouping =
			input.tab === "clients"
				? { id: client.id, name: client.name }
				: input.tab === "projects"
					? { id: project.id, name: project.name }
					: { id: user.id, name: user.name };

		const rows = await db
			.select({
				id: grouping.id,
				name: grouping.name,
				secondsTotal: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
			})
			.from(timeEntry)
			.innerJoin(project, eq(timeEntry.projectId, project.id))
			.innerJoin(client, eq(project.clientId, client.id))
			.innerJoin(user, eq(timeEntry.userId, user.id))
			.where(where)
			.groupBy(grouping.id, grouping.name)
			.orderBy(desc(sql`sum(${timeEntry.durationSeconds})`));

		const mapped = rows.map((r) => ({
			id: r.id,
			name: r.name,
			secondsTotal: Number(r.secondsTotal),
		}));
		// Reported separately from `totalSeconds`, not folded into it: this is time
		// the report cannot attribute, and adding it to the total would make the
		// per-client rows stop summing to the figure above them.
		//
		// Only meaningful org-wide. A Team Lead scoped to a subset of projects has
		// no claim on time that is attributed to no project at all, and neither does
		// a run already filtered to one client or project.
		const orgWide =
			projectIds === null &&
			!input.projectId &&
			!input.clientId &&
			!input.userId;
		const unfiled = orgWide
			? await unfiledTotals(ctx, { from: input.from, to: input.to })
			: { seconds: 0 };

		return {
			rows: mapped,
			totalSeconds: mapped.reduce((sum, r) => sum + r.secondsTotal, 0),
			unfiledSeconds: unfiled.seconds,
		};
	},

	/**
	 * Time Report level 2: every entry behind the clicked number.
	 *
	 * Capped at `MAX_DETAIL_ROWS`, with the true totals fetched alongside rather
	 * than summed from the rows. The date ceiling in `schema/reports.ts` bounds
	 * how MUCH TIME a report may span and says nothing about how many rows that
	 * is: a year-wide, unfiltered detail over a busy org is every entry it has,
	 * serialized into one server-function response and then summed in the
	 * browser. The aggregate is a second, cheap query precisely so the Total and
	 * the CSV row count stay honest when the table itself is truncated — a
	 * silently short total is a worse failure than a slow one.
	 */
	timeDetail: async (
		ctx: Ctx,
		input: TimeReportDetailInput,
	): Promise<TimeReportDetail> => {
		const { projectIds } = await reportScope(ctx);
		const where = projectTimeWhere(ctx, input, projectIds);

		const [rows, totals] = await Promise.all([
			db
				.select({
					id: timeEntry.id,
					date: timeEntry.date,
					clientName: client.name,
					projectName: project.name,
					taskName: task.name,
					description: timeEntry.description,
					userName: user.name,
					overtime: timeEntry.overtime,
					durationSeconds: timeEntry.durationSeconds,
				})
				.from(timeEntry)
				.innerJoin(project, eq(timeEntry.projectId, project.id))
				.innerJoin(client, eq(project.clientId, client.id))
				.innerJoin(task, eq(timeEntry.taskId, task.id))
				.innerJoin(user, eq(timeEntry.userId, user.id))
				.where(where)
				.orderBy(
					input.groupBy === "person" ? asc(user.name) : desc(timeEntry.date),
					input.groupBy === "person" ? desc(timeEntry.date) : asc(user.name),
				)
				.limit(MAX_DETAIL_ROWS),
			db
				.select({
					rowCount: sql<string>`count(*)`,
					seconds: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
				})
				.from(timeEntry)
				.innerJoin(project, eq(timeEntry.projectId, project.id))
				.innerJoin(client, eq(project.clientId, client.id))
				.where(where),
		]);

		const totalRows = Number(totals[0]?.rowCount ?? 0);
		return {
			rows,
			totalRows,
			totalSeconds: Number(totals[0]?.seconds ?? 0),
			truncated: totalRows > rows.length,
		};
	},

	/**
	 * Budget burn (6.6). Hours-only math by design: a EUR budget, when entered, is
	 * shown as context beside the hour figures and never computed against — there
	 * are no rates in this system to compute with.
	 */
	budgetBurn: async (ctx: Ctx) => {
		const { access, projectIds } = await reportScope(ctx);

		const rows = await db
			.select({
				projectId: project.id,
				name: project.name,
				clientName: client.name,
				budgetSeconds: project.budgetSeconds,
				budgetAmount: project.budgetAmount,
				consumedSeconds: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
			})
			.from(project)
			.innerJoin(client, eq(project.clientId, client.id))
			// The org predicate is stated on the entry side too, rather than left to
			// the FK argument ("a foreign org's entry cannot point at this org's
			// project"). It belongs in the JOIN, not the WHERE — in the WHERE it
			// would turn this left join into an inner one and silently drop every
			// project with no time logged against it, which is exactly the row a
			// burn report needs to show as 0%.
			.leftJoin(
				timeEntry,
				and(
					eq(timeEntry.projectId, project.id),
					eq(timeEntry.organizationId, ctx.organizationId),
				),
			)
			.where(
				and(
					eq(project.organizationId, ctx.organizationId),
					eq(project.status, "active"),
					// One row per active Fixed Scope project — the only type that carries
					// an hour budget.
					eq(project.type, "fixed_scope"),
					projectIds ? inArray(project.id, projectIds) : undefined,
				),
			)
			.groupBy(project.id, client.name);

		return rows
			.map((r) => {
				const consumedSeconds = Number(r.consumedSeconds);
				const budgetSeconds = r.budgetSeconds;
				return {
					projectId: r.projectId,
					name: r.name,
					clientName: r.clientName,
					budgetSeconds,
					// Display-only context, and only for those allowed to see money.
					budgetAmount: access.canViewProjectMoney(r.projectId)
						? r.budgetAmount
						: null,
					consumedSeconds,
					remainingSeconds:
						budgetSeconds != null ? budgetSeconds - consumedSeconds : null,
					burnPct:
						budgetSeconds != null && budgetSeconds > 0
							? Math.round((consumedSeconds / budgetSeconds) * 100)
							: null,
				};
			})
			.sort((a, b) => (b.burnPct ?? -1) - (a.burnPct ?? -1));
	},

	/** Overtime report (6.5). Admin sees everyone; PM/TL scoped to their projects. */
	overtime: async (ctx: Ctx, input: MonthReportInput) => {
		const { projectIds } = await reportScope(ctx);
		const { from, to } = monthBounds(input.year, input.month);
		const yearStart = `${input.year}-01-01`;
		const yearEnd = `${input.year}-12-31`;

		const scopeWhere = (rangeFrom: string, rangeTo: string) =>
			and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.overtime, true),
				isNotNull(timeEntry.projectId),
				gte(timeEntry.date, rangeFrom),
				lte(timeEntry.date, rangeTo),
				projectIds ? inArray(timeEntry.projectId, projectIds) : undefined,
			);

		const [monthRows, yearRows] = await Promise.all([
			db
				.select({
					userId: timeEntry.userId,
					name: user.name,
					total: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
				})
				.from(timeEntry)
				.innerJoin(user, eq(timeEntry.userId, user.id))
				.where(scopeWhere(from, to))
				.groupBy(timeEntry.userId, user.name),
			db
				.select({
					userId: timeEntry.userId,
					total: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
				})
				.from(timeEntry)
				.where(scopeWhere(yearStart, yearEnd))
				.groupBy(timeEntry.userId),
		]);

		const yearByUser = new Map(
			yearRows.map((r) => [r.userId, Number(r.total)]),
		);
		return monthRows
			.map((r) => ({
				userId: r.userId,
				name: r.name,
				monthSeconds: Number(r.total),
				yearSeconds: yearByUser.get(r.userId) ?? 0,
			}))
			.sort((a, b) => b.monthSeconds - a.monthSeconds);
	},

	/** The entries behind an overtime number. */
	overtimeDetail: async (
		ctx: Ctx,
		input: MonthReportInput & { userId: string },
	) => {
		const { projectIds } = await reportScope(ctx);
		const { from, to } = monthBounds(input.year, input.month);

		return db
			.select({
				id: timeEntry.id,
				date: timeEntry.date,
				projectName: project.name,
				taskName: task.name,
				description: timeEntry.description,
				durationSeconds: timeEntry.durationSeconds,
			})
			.from(timeEntry)
			.innerJoin(project, eq(timeEntry.projectId, project.id))
			.innerJoin(task, eq(timeEntry.taskId, task.id))
			.where(
				and(
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, input.userId),
					eq(timeEntry.overtime, true),
					gte(timeEntry.date, from),
					lte(timeEntry.date, to),
					projectIds ? inArray(timeEntry.projectId, projectIds) : undefined,
				),
			)
			.orderBy(asc(timeEntry.date));
	},

	/**
	 * Absence report (6.3), Admin only. Computed from ENTRIES only, never from
	 * close-sheet overrides — the two are allowed to diverge, and when they do it
	 * means someone forgot to log absence (PRD decision 3).
	 */
	absence: async (ctx: Ctx, input: AbsenceReportInput) => {
		await requireAdmin(ctx);

		const yearStart = `${input.year}-01-01`;
		const yearEnd = `${input.year}-12-31`;
		const monthRange = input.month
			? monthBounds(input.year, input.month)
			: null;

		const select = (from: string, to: string) =>
			db
				.select({
					userId: timeEntry.userId,
					name: user.name,
					taskId: task.id,
					taskKey: task.systemKey,
					taskName: task.name,
					total: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
				})
				.from(timeEntry)
				.innerJoin(task, eq(timeEntry.taskId, task.id))
				.innerJoin(user, eq(timeEntry.userId, user.id))
				.where(
					and(
						eq(timeEntry.organizationId, ctx.organizationId),
						eq(task.isAbsence, true),
						gte(timeEntry.date, from),
						lte(timeEntry.date, to),
					),
				)
				.groupBy(
					timeEntry.userId,
					user.name,
					task.id,
					task.systemKey,
					task.name,
				);

		const [absenceTasks, ytdRows, monthRows] = await Promise.all([
			// The columns the table draws, named by the caller-stable system key
			// rather than by label. The route used to look its two columns up by the
			// literal strings "Vacation" and "Sick Leave", which is a display name:
			// renaming the task, or adding a third kind of absence, silently emptied
			// or omitted a column. Every absence task is site-scoped (the schema's
			// check constraint sees to it) and therefore carries a key.
			db
				.select({
					key: task.systemKey,
					id: task.id,
					label: task.name,
				})
				.from(task)
				.where(and(eq(task.scope, "site"), eq(task.isAbsence, true)))
				// Seed order, so Vacation stays the leftmost column it has always
				// been; a third absence task would land after both rather than
				// alphabetically between them.
				.orderBy(asc(task.createdAt), asc(task.name)),
			select(yearStart, yearEnd),
			monthRange ? select(monthRange.from, monthRange.to) : Promise.resolve([]),
		]);

		// Key on the system key where there is one, the task id otherwise, so a
		// column can never collide with another task that happens to share a name.
		const columnKey = (row: { taskKey: string | null; taskId: string }) =>
			row.taskKey ?? row.taskId;

		const byUser = new Map<
			string,
			{
				userId: string;
				name: string;
				monthByTask: Record<string, number>;
				ytdByTask: Record<string, number>;
				monthSeconds: number;
				ytdSeconds: number;
			}
		>();
		const ensure = (userId: string, name: string) => {
			let row = byUser.get(userId);
			if (!row) {
				row = {
					userId,
					name,
					monthByTask: {},
					ytdByTask: {},
					monthSeconds: 0,
					ytdSeconds: 0,
				};
				byUser.set(userId, row);
			}
			return row;
		};

		for (const r of ytdRows) {
			const row = ensure(r.userId, r.name);
			row.ytdByTask[columnKey(r)] = Number(r.total);
			row.ytdSeconds += Number(r.total);
		}
		for (const r of monthRows) {
			const row = ensure(r.userId, r.name);
			row.monthByTask[columnKey(r)] = Number(r.total);
			row.monthSeconds += Number(r.total);
		}

		// Unit is hours; the UI offers a toggle to display as days, which is why
		// the divisor travels with the payload rather than being hardcoded there.
		return {
			workingDaySeconds: WORKING_DAY_SECONDS,
			columns: absenceTasks.map((t) => ({
				key: t.key ?? t.id,
				label: t.label,
			})),
			rows: [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name)),
		};
	},

	/**
	 * Reported vs Final variance (6.4), Admin only. The undertracking diagnostic —
	 * and the reason free entry editing is tolerated: instead of preventing drift,
	 * we measure it.
	 *
	 * Reads the Reported value SNAPSHOTTED at finalization, not a live recompute.
	 * Entries stay editable after a month is finalized, so a live Reported would
	 * drift away from the Final it was compared against and the variance would
	 * quietly stop meaning anything.
	 */
	variance: async (ctx: Ctx, input: MonthReportInput) => {
		await requireAdmin(ctx);

		const rows = await db
			.select({
				userId: monthlyCloseRow.userId,
				name: user.name,
				reported: sql<string>`coalesce(sum(${monthlyCloseRow.reportedAtFinalizeSeconds}), 0)`,
				final: sql<string>`coalesce(sum(${monthlyCloseRow.finalSeconds}), 0)`,
			})
			.from(monthlyCloseRow)
			.innerJoin(monthlyClose, eq(monthlyCloseRow.closeId, monthlyClose.id))
			.innerJoin(user, eq(monthlyCloseRow.userId, user.id))
			.where(
				and(
					eq(monthlyClose.organizationId, ctx.organizationId),
					eq(monthlyClose.year, input.year),
					eq(monthlyClose.month, input.month),
					// Populates as closes are finalized; empty for open months.
					eq(monthlyClose.status, "finalized"),
				),
			)
			.groupBy(monthlyCloseRow.userId, user.name);

		return rows
			.map((r) => {
				const reportedSeconds = Number(r.reported);
				const finalSeconds = Number(r.final);
				return {
					userId: r.userId,
					name: r.name,
					reportedSeconds,
					finalSeconds,
					diffSeconds: finalSeconds - reportedSeconds,
					diffPct:
						reportedSeconds > 0
							? Math.round(
									((finalSeconds - reportedSeconds) / reportedSeconds) * 1000,
								) / 10
							: null,
				};
			})
			.sort((a, b) => b.diffSeconds - a.diffSeconds);
	},

	/** Variance across months, to spot chronic undertrackers. */
	varianceTrend: async (
		ctx: Ctx,
		input: { year: number; month: number; months: number },
	) => {
		await requireAdmin(ctx);

		return Promise.all(
			trailingMonths(input, input.months).map(async (p) => ({
				...p,
				rows: await reportsService.variance(ctx, p),
			})),
		);
	},

	/**
	 * Utilization (6.8), Admin only. Deliberately NOT Harvest's definition:
	 *
	 *     Utilization = Final hours on non-Internal projects / Expected hours
	 *
	 * The numerator is what was actually invoiced after all adjustments, the
	 * denominator the same Expected the close sheet uses. Note there is no
	 * billable flag anywhere in the system — "billable" is derived entirely from
	 * project type and close data.
	 */
	utilization: async (ctx: Ctx, input: MonthReportInput) => {
		await requireAdmin(ctx);
		const shared = await utilizationSpan(ctx, [input]);
		return computeUtilization(input, shared);
	},

	/**
	 * Utilization across months.
	 *
	 * Each point is the same roll-up as the single-month headline, so the trend's
	 * last point and the number above it can never disagree — they used to, the
	 * trend averaging percentages while the PDF divided the totals.
	 *
	 * The reads are resolved for the WHOLE span up front (`utilizationSpan`) and
	 * then sliced per point. This used to run `computeUtilization` once per month
	 * inside a `Promise.all`, six queries each — so a 24-month trend fired ~144
	 * queries simultaneously at a connection pool of ten, and two of the six
	 * (the member list and the archived set) are not month-dependent at all and
	 * were therefore issued 24 identical times.
	 */
	utilizationTrend: async (
		ctx: Ctx,
		input: { year: number; month: number; months: number },
	) => {
		await requireAdmin(ctx);

		const months = trailingMonths(input, input.months);
		const shared = await utilizationSpan(ctx, months);

		return months.map((p) => ({
			...p,
			...rollUpUtilization(computeUtilization(p, shared)),
		}));
	},
};

const spanMonthKey = (m: { year: number; month: number }) =>
	`${m.year}-${String(m.month).padStart(2, "0")}`;

type UtilizationTotals = { final: number; expected: number | null };

/** Everything a run of utilization months reads, resolved once for the span.
 *
 *  Split out from `computeUtilization` so a trend pays for each read once
 *  instead of once per point. Everything here is either genuinely span-wide
 *  (the member list, the archived set) or a single grouped query keyed by month
 *  (`yyyy-MM`), which `computeUtilization` then indexes into synchronously. */
type UtilizationSpan = {
	members: { userId: string; name: string }[];
	archived: Set<string>;
	typesByMonth: Map<string, Map<string, ResolvedMemberType>>;
	fundByMonth: Map<string, number>;
	absenceByMonth: Map<string, Map<string, number>>;
	totalsByMonth: Map<string, Map<string, UtilizationTotals>>;
};

const utilizationSpan = async (
	ctx: Ctx,
	months: { year: number; month: number }[],
	onlyUserId?: string,
): Promise<UtilizationSpan> => {
	// trailingMonths always returns a contiguous, oldest-first run, so the span
	// is just its ends. Guarded anyway: `months` is never empty in practice, and
	// an empty span must not turn into an unbounded scan.
	const first = months[0];
	const last = months[months.length - 1];
	if (!first || !last) {
		return {
			members: [],
			archived: new Set(),
			typesByMonth: new Map(),
			fundByMonth: new Map(),
			absenceByMonth: new Map(),
			totalsByMonth: new Map(),
		};
	}
	const spanFrom = monthBounds(first.year, first.month).from;
	const spanTo = monthBounds(last.year, last.month).to;

	const [rows, members, archived, fundByMonth, absenceByMonth, typeEntries] =
		await Promise.all([
			db
				.select({
					year: monthlyClose.year,
					month: monthlyClose.month,
					userId: monthlyCloseRow.userId,
					// Prefer the frozen Expected from finalization, so an admin editing a
					// past month's hour fund can't retroactively move percentages that
					// have already been reported.
					expected: sql<
						string | null
					>`max(${monthlyCloseRow.expectedAtFinalizeSeconds})`,
					final: sql<string>`coalesce(sum(case when ${project.type} <> 'internal' then ${monthlyCloseRow.finalSeconds} else 0 end), 0)`,
				})
				.from(monthlyCloseRow)
				.innerJoin(monthlyClose, eq(monthlyCloseRow.closeId, monthlyClose.id))
				.innerJoin(project, eq(monthlyClose.projectId, project.id))
				.where(
					and(
						eq(monthlyClose.organizationId, ctx.organizationId),
						eq(monthlyClose.status, "finalized"),
						or(
							...months.map((m) =>
								and(
									eq(monthlyClose.year, m.year),
									eq(monthlyClose.month, m.month),
								),
							),
						),
					),
				)
				.groupBy(monthlyClose.year, monthlyClose.month, monthlyCloseRow.userId),
			db
				.select({ userId: member.userId, name: user.name })
				.from(member)
				.innerJoin(user, eq(member.userId, user.id))
				.where(
					and(
						eq(member.organizationId, ctx.organizationId),
						onlyUserId ? eq(member.userId, onlyUserId) : undefined,
					),
				),
			membersService.archivedUserIds(ctx),
			hourFundService.getMany(ctx, months),
			absenceDaysByUserPerMonth(ctx, spanFrom, spanTo),
			// Member type is effective-dated, so it genuinely differs per month and
			// stays one indexed read each — but they now run concurrently with
			// everything else instead of serialized behind their own point.
			Promise.all(
				months.map(async (m) => {
					const types = await membersService.typesForMonth(
						ctx,
						m.year,
						m.month,
					);
					return [spanMonthKey(m), types] as const;
				}),
			),
		]);

	const totalsByMonth = new Map<string, Map<string, UtilizationTotals>>();
	for (const r of rows) {
		const key = spanMonthKey({ year: r.year, month: r.month });
		let bucket = totalsByMonth.get(key);
		if (!bucket) {
			bucket = new Map();
			totalsByMonth.set(key, bucket);
		}
		bucket.set(r.userId, {
			final: Number(r.final),
			expected: r.expected == null ? null : Number(r.expected),
		});
	}

	return {
		members,
		archived,
		typesByMonth: new Map(typeEntries),
		fundByMonth,
		absenceByMonth,
		totalsByMonth,
	};
};

/** One month's rows, read entirely out of an already-resolved span. Synchronous
 *  on purpose: every query it needs has been made, so a trend can map over its
 *  points without fanning out again. */
const computeUtilization = (
	input: MonthReportInput,
	span: UtilizationSpan,
	onlyUserId?: string,
) => {
	const key = spanMonthKey(input);
	const types =
		span.typesByMonth.get(key) ?? new Map<string, ResolvedMemberType>();
	// Absent means "no row for this month", which for a fund is null — no
	// Expected math applies — and NOT zero. See hourFundService.get.
	const fundSeconds = span.fundByMonth.get(key) ?? null;
	const absence = span.absenceByMonth.get(key) ?? new Map<string, number>();
	const finalByUser =
		span.totalsByMonth.get(key) ?? new Map<string, UtilizationTotals>();
	const { members, archived } = span;

	return (
		members
			// Overhead is excluded from the org-wide list: these people almost never
			// work on client projects, and including them would drag every team
			// average down. Archived people go for the same reason — a leaver with no
			// hours is not an under-sold month. The single-person view keeps both — an
			// overhead person asking about their own month should still get an answer.
			.filter(
				(m) =>
					onlyUserId != null ||
					((types.get(m.userId)?.type ?? "billable") !== "overhead" &&
						!archived.has(m.userId)),
			)
			.map((m) => {
				const memberType = types.get(m.userId) ?? {
					type: "billable" as const,
					expectedSecondsOverride: null,
				};
				const totals = finalByUser.get(m.userId);
				const expectedSeconds =
					totals?.expected ??
					expectedSecondsFor(
						memberType,
						fundSeconds,
						absence.get(m.userId) ?? 0,
					);
				const finalSeconds = totals?.final ?? 0;

				return {
					userId: m.userId,
					name: m.name,
					memberType: memberType.type,
					finalSeconds,
					expectedSeconds,
					// A contractor with no explicit expected value displays Final hours
					// with no percentage — the "/" rows of the old sheet.
					utilizationPct: utilizationPctOf(finalSeconds, expectedSeconds),
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name))
	);
};

// Re-exported so callers computing Expected outside the close sheet (Slack
// nudges, the compliance report) share one definition of the formula.
export { effectiveFinal, expectedSecondsFor };
