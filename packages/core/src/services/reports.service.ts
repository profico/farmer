import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "../db";
import { user } from "../db/schema/auth";
import { client, project, task, timeEntry } from "../db/schema/domain";
import { monthBounds } from "../lib/time";
import type {
	AbsenceReportInput,
	MonthReportInput,
	TimeReportDetailInput,
	TimeReportSummaryInput,
} from "../schema/reports";
import { type Access, accessService } from "./access.service";
import { ctxAccess } from "./context";
import { WORKING_DAY_SECONDS } from "./hour-fund.service";
import { ledgerWhere } from "./ledger";
import type { Ctx } from "./types";
import { unfiledTotals } from "./unfiled";

// ── Scoping ────────────────────────────────────────────────────────────────
// Admin sees everything. Everyone else sees the union of two things — the
// projects they run (PM, or a Team Lead assigned there) and the people they
// lead — plus, always, themselves. That is the §4 matrix for Time and Overtime:
// a PM their projects, a Team Lead their people and their projects, a Member
// their own entries only. Nobody is refused: a report about yourself is still a
// report, and the Teammates tab of a Member is one row.

type ReportScope = {
	access: Access;
	/** Projects whose every entry the caller may see; null = all. */
	projectIds: string[] | null;
	/** People whose every entry the caller may see; null = all. */
	userIds: string[] | null;
};

const reportScope = async (ctx: Ctx): Promise<ReportScope> => {
	const access = await ctxAccess(ctx);
	return {
		access,
		projectIds: access.scopeFor("team_lead"),
		userIds: access.isAdmin ? null : [access.userId, ...access.peopleLed()],
	};
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
//
// The `project` scope is exactly that `isNotNull`. A client filter reads
// `project.clientId`, which every caller below already has joined.
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
	scope: ReportScope,
) =>
	ledgerWhere(ctx, { from: input.from, to: input.to }, "project", {
		visibleProjectIds: scope.projectIds,
		visibleUserIds: scope.userIds,
		projectId: input.projectId,
		clientId: input.clientId,
		taskId: input.taskId,
		userId: input.userId,
	});

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
		const scope = await reportScope(ctx);
		const { projectIds } = scope;
		const where = projectTimeWhere(ctx, input, scope);

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
		const scope = await reportScope(ctx);
		const where = projectTimeWhere(ctx, input, scope);

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

	/** Overtime report (6.5). Admin sees everyone; everyone else their projects
	 *  and their people, themselves included. */
	overtime: async (ctx: Ctx, input: MonthReportInput) => {
		const { projectIds, userIds } = await reportScope(ctx);
		const { from, to } = monthBounds(input.year, input.month);
		const yearStart = `${input.year}-01-01`;
		const yearEnd = `${input.year}-12-31`;

		const scopeWhere = (rangeFrom: string, rangeTo: string) =>
			ledgerWhere(ctx, { from: rangeFrom, to: rangeTo }, "project", {
				overtimeOnly: true,
				visibleProjectIds: projectIds,
				visibleUserIds: userIds,
			});

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
		const { projectIds, userIds } = await reportScope(ctx);
		const { from, to } = monthBounds(input.year, input.month);

		return (
			db
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
				// `project` scope: the inner join on `project` above already dropped
				// project-less rows, so stating it changes nothing but where it is said.
				.where(
					ledgerWhere(ctx, { from, to }, "project", {
						userId: input.userId,
						overtimeOnly: true,
						visibleProjectIds: projectIds,
						visibleUserIds: userIds,
					}),
				)
				.orderBy(asc(timeEntry.date))
		);
	},

	/**
	 * Absence report (6.3), scoped by `accessService.peopleScope` like every
	 * people-shaped report — everyone for Admin, otherwise the caller, their
	 * list, and everyone on the projects they manage. Computed from ENTRIES
	 * only, never from close-sheet overrides — the two are allowed to diverge,
	 * and when they do it means someone forgot to log absence (PRD decision 3).
	 */
	absence: async (ctx: Ctx, input: AbsenceReportInput) => {
		// People-shaped, so scoped by people: everyone for Admin, otherwise the
		// caller, their list, and everyone on the projects they manage.
		const access = await ctxAccess(ctx);
		const people = await accessService.peopleScope(ctx, access);
		const visibleUserIds = people ? [...people] : undefined;

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
					ledgerWhere(ctx, { from, to }, "absence", {
						userIds: visibleUserIds,
					}),
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
};
