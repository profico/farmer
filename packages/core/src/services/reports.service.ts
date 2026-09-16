import { and, asc, countDistinct, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { user } from "../db/schema/auth";
import { client, project, task, timeEntry } from "../db/schema/domain";
import type {
	AbsenceReportInput,
	OvertimeReportInput,
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
		activeOnly?: boolean;
		q?: string;
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
		activeOnly: input.activeOnly,
		q: input.q,
	});

export type TimeReportRow = {
	id: string;
	name: string;
	secondsTotal: number;
	/** Team tab: time off in the period, shown beside work. Zero elsewhere —
	 *  time off belongs to nobody's client or project. */
	timeOffSeconds: number;
	/** Clients: projects with time in the period. Projects: people with time.
	 *  Team: projects the person logged on. */
	count: number;
	/** Projects tab only; null on the other tabs. */
	clientName: string | null;
	code: string | null;
	archived: boolean;
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
	clientId: string;
	clientName: string;
	projectId: string;
	projectName: string;
	projectCode: string | null;
	taskId: string;
	taskName: string;
	description: string;
	userId: string;
	userName: string;
	overtime: boolean;
	durationSeconds: number;
};

export type OvertimeEntry = {
	id: string;
	date: string;
	projectName: string;
	projectCode: string | null;
	taskName: string;
	description: string;
	durationSeconds: number;
};

export type OvertimeRow = {
	userId: string;
	name: string;
	/** Flagged entries in the period. */
	count: number;
	seconds: number;
	/** The entries behind the figure, in date order. */
	entries: OvertimeEntry[];
};

export type OvertimeReport = {
	rows: OvertimeRow[];
	totalSeconds: number;
	totalEntries: number;
};

export type AbsenceEntry = {
	id: string;
	date: string;
	/** The task's system key ("vacation", "sick", "paid_leave"), or its id for
	 *  an absence task without one. Matches `AbsenceReport.columns[].key`. */
	taskKey: string;
	taskName: string;
	description: string;
	durationSeconds: number;
};

export type AbsenceRow = {
	userId: string;
	name: string;
	seconds: number;
	/** Seconds per absence task, keyed like `columns`. */
	byTask: Record<string, number>;
	/** The entries behind the figure, in date order. */
	entries: AbsenceEntry[];
};

export type AbsenceReport = {
	workingDaySeconds: number;
	columns: { key: string; label: string }[];
	rows: AbsenceRow[];
};

/** Time off per person for the Team tab. People-shaped, so it follows the
 *  people scope rather than the project scope: an admin sees everyone's, a
 *  lead their people's, a PM the people on their projects, a member their own.
 *  Anyone in the rows but outside that scope reads as no time off. */
const teamTimeOff = async (
	ctx: Ctx,
	scope: ReportScope,
	range: { from: string; to: string },
	userIds: string[],
): Promise<Map<string, number>> => {
	const people = await accessService.peopleScope(ctx, scope.access);
	const visible = people ? userIds.filter((id) => people.has(id)) : userIds;
	if (visible.length === 0) return new Map();
	const rows = await db
		.select({
			userId: timeEntry.userId,
			total: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
		})
		.from(timeEntry)
		.innerJoin(task, eq(timeEntry.taskId, task.id))
		.where(ledgerWhere(ctx, range, "absence", { userIds: visible }))
		.groupBy(timeEntry.userId);
	return new Map(rows.map((r) => [r.userId, Number(r.total)]));
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
		// The second figure each tab shows beside the hours: how many projects a
		// client had time on, how many people a project had, how many projects a
		// person touched.
		const counted =
			input.tab === "projects"
				? countDistinct(timeEntry.userId)
				: countDistinct(timeEntry.projectId);

		const rows = await db
			.select({
				id: grouping.id,
				name: grouping.name,
				secondsTotal: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
				count: counted,
			})
			.from(timeEntry)
			.innerJoin(project, eq(timeEntry.projectId, project.id))
			.innerJoin(client, eq(project.clientId, client.id))
			.innerJoin(user, eq(timeEntry.userId, user.id))
			.where(where)
			.groupBy(grouping.id, grouping.name)
			.orderBy(desc(sql`sum(${timeEntry.durationSeconds})`));

		// The Projects tab reads the project itself — code, client, whether it is
		// archived — and the Team tab reads time off: one lookup each, keyed by
		// the rows that came back, rather than widening the grouped query.
		const projectMeta =
			input.tab === "projects" && rows.length > 0
				? new Map(
						(
							await db
								.select({
									id: project.id,
									code: project.code,
									status: project.status,
									clientName: client.name,
								})
								.from(project)
								.innerJoin(client, eq(project.clientId, client.id))
								.where(
									inArray(
										project.id,
										rows.map((r) => r.id),
									),
								)
						).map((p) => [p.id, p]),
					)
				: new Map<
						string,
						{ code: string | null; status: string; clientName: string }
					>();
		const timeOff =
			input.tab === "teammates" && rows.length > 0
				? await teamTimeOff(
						ctx,
						scope,
						{ from: input.from, to: input.to },
						rows.map((r) => r.id),
					)
				: new Map<string, number>();

		const mapped: TimeReportRow[] = rows.map((r) => {
			const meta = projectMeta.get(r.id);
			return {
				id: r.id,
				name: r.name,
				secondsTotal: Number(r.secondsTotal),
				timeOffSeconds: timeOff.get(r.id) ?? 0,
				count: Number(r.count),
				clientName: meta?.clientName ?? null,
				code: meta?.code ?? null,
				archived: meta?.status === "archived",
			};
		});
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
					clientId: client.id,
					clientName: client.name,
					projectId: project.id,
					projectName: project.name,
					projectCode: project.code,
					taskId: task.id,
					taskName: task.name,
					description: timeEntry.description,
					userId: user.id,
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
				// One fixed order — the Breakdown regroups on the client and keeps
				// this order inside every group.
				.orderBy(asc(timeEntry.date), asc(user.name), asc(timeEntry.id))
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
	 * Overtime report (6.5): only the entries a person flagged as overtime when
	 * logging them — nothing is inferred from the fund — per person over the
	 * period, each with the entries behind the figure. Admin sees everyone;
	 * everyone else their projects and their people, themselves included.
	 *
	 * The entries ride along rather than being a second call: overtime is a
	 * hand-set flag and rare, so a period's whole list is a few hundred rows
	 * at most, and the range ceiling bounds it.
	 */
	overtime: async (
		ctx: Ctx,
		input: OvertimeReportInput,
	): Promise<OvertimeReport> => {
		const { projectIds, userIds } = await reportScope(ctx);
		const entries = await db
			.select({
				id: timeEntry.id,
				date: timeEntry.date,
				userId: timeEntry.userId,
				userName: user.name,
				projectName: project.name,
				projectCode: project.code,
				taskName: task.name,
				description: timeEntry.description,
				durationSeconds: timeEntry.durationSeconds,
			})
			.from(timeEntry)
			.innerJoin(project, eq(timeEntry.projectId, project.id))
			.innerJoin(task, eq(timeEntry.taskId, task.id))
			.innerJoin(user, eq(timeEntry.userId, user.id))
			// `project` scope: the inner join on `project` above already dropped
			// project-less rows, so stating it changes nothing but where it is said.
			.where(
				ledgerWhere(ctx, { from: input.from, to: input.to }, "project", {
					overtimeOnly: true,
					activeOnly: input.activeOnly,
					visibleProjectIds: projectIds,
					visibleUserIds: userIds,
				}),
			)
			.orderBy(asc(timeEntry.date), asc(timeEntry.id));

		const byUser = new Map<string, OvertimeRow>();
		for (const e of entries) {
			const row = byUser.get(e.userId) ?? {
				userId: e.userId,
				name: e.userName,
				count: 0,
				seconds: 0,
				entries: [],
			};
			row.count += 1;
			row.seconds += e.durationSeconds;
			row.entries.push({
				id: e.id,
				date: e.date,
				projectName: e.projectName,
				projectCode: e.projectCode,
				taskName: e.taskName,
				description: e.description,
				durationSeconds: e.durationSeconds,
			});
			byUser.set(e.userId, row);
		}
		const rows = [...byUser.values()].sort(
			(a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name),
		);
		return {
			rows,
			totalSeconds: rows.reduce((sum, r) => sum + r.seconds, 0),
			totalEntries: entries.length,
		};
	},

	/**
	 * Absence report (6.3): time-off entries only — Vacation, Sick Leave, Paid
	 * Leave — per person over the period, split by task and with the entries
	 * behind the figure. Computed from ENTRIES only, never from close-sheet
	 * overrides — the two are allowed to diverge, and when they do it means
	 * someone forgot to log absence (PRD decision 3).
	 *
	 * Scoped by `accessService.peopleScope` like every people-shaped report:
	 * everyone for Admin, otherwise the caller, their list, and everyone on
	 * the projects they manage.
	 */
	absence: async (
		ctx: Ctx,
		input: AbsenceReportInput,
	): Promise<AbsenceReport> => {
		const access = await ctxAccess(ctx);
		const people = await accessService.peopleScope(ctx, access);
		const visibleUserIds = people ? [...people] : undefined;

		const [absenceTasks, entries] = await Promise.all([
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
			db
				.select({
					id: timeEntry.id,
					date: timeEntry.date,
					userId: timeEntry.userId,
					userName: user.name,
					taskId: task.id,
					taskKey: task.systemKey,
					taskName: task.name,
					description: timeEntry.description,
					durationSeconds: timeEntry.durationSeconds,
				})
				.from(timeEntry)
				.innerJoin(task, eq(timeEntry.taskId, task.id))
				.innerJoin(user, eq(timeEntry.userId, user.id))
				.where(
					ledgerWhere(ctx, { from: input.from, to: input.to }, "absence", {
						userIds: visibleUserIds,
					}),
				)
				.orderBy(asc(timeEntry.date), asc(timeEntry.id)),
		]);

		// Key on the system key where there is one, the task id otherwise, so a
		// column can never collide with another task that happens to share a name.
		const columnKey = (row: { taskKey: string | null; taskId: string }) =>
			row.taskKey ?? row.taskId;

		const byUser = new Map<string, AbsenceRow>();
		for (const e of entries) {
			const row = byUser.get(e.userId) ?? {
				userId: e.userId,
				name: e.userName,
				seconds: 0,
				byTask: {},
				entries: [],
			};
			const key = columnKey(e);
			row.seconds += e.durationSeconds;
			row.byTask[key] = (row.byTask[key] ?? 0) + e.durationSeconds;
			row.entries.push({
				id: e.id,
				date: e.date,
				taskKey: key,
				taskName: e.taskName,
				description: e.description,
				durationSeconds: e.durationSeconds,
			});
			byUser.set(e.userId, row);
		}

		return {
			// Unit is hours; the screen shows days = hours ÷ working day for reading
			// only, which is why the divisor travels with the payload rather than
			// being hardcoded there.
			workingDaySeconds: WORKING_DAY_SECONDS,
			columns: absenceTasks.map((t) => ({
				key: t.key ?? t.id,
				label: t.label,
			})),
			rows: [...byUser.values()].sort(
				(a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name),
			),
		};
	},
};
