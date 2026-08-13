// The time-entry ledger: one definition of what counts as logged time, and one
// place the org + range + access predicate is written.
//
// Fifteen hand-rolled `sum(durationSeconds) ... groupBy` queries used to spell
// this out separately across reports, close, compliance, unfiled, not-on-invoice
// and projects. Three of them disagreed, and the disagreement was visible to
// users: the Tracking tab and the Time tab answered "hours logged this month"
// differently for the same person in the same month.
//
// What varies legitimately between callers is the PROJECTION — which columns,
// which joins, which grouping key. What must not vary is the CLASSIFICATION
// (what is worked time, what is absence, what is unfiled) and the tenancy and
// range predicate. So this module owns the predicate and the scope vocabulary,
// and exposes the two aggregate shapes that were genuinely duplicated. Callers
// with a bespoke projection compose `ledgerWhere` rather than being forced
// through a grouped API that would need every join as a parameter.
//
// Scope only over `timeEntry`. The close-sheet aggregates (variance,
// utilization) sum `monthlyCloseRow`, which is a different aggregate with its
// own snapshot semantics, and are deliberately not folded in here.

import { type SQL, and, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { project, task, timeEntry } from "../db/schema/domain";
import type { Ctx } from "./types";

export type DateRange = { from: string; to: string };

/** Which slice of tracked time a caller means.
 *
 *  `worked`, `absence` and `all` partition the ledger; `project` and `unfiled`
 *  very nearly partition `worked`. Absence carries no project by definition —
 *  the taxonomy guard rejects an absence entry pinned to one — which is what
 *  makes `project` and `unfiled` a split of the rest.
 *
 *  The one gap is the Break built-in logged without a project: worked time
 *  (a rest break is counted within working hours, which is why the day assembler
 *  carves it out of the day's target rather than adding it on top) that is
 *  nonetheless in neither bucket. See `unfiled` below for why. */
export type LedgerScope =
	/** Time the person actually worked, attributed or not. The honest answer to
	 *  "did they log enough hours", because an unfiled meeting is still work. */
	| "worked"
	/** Worked time attributed to a project. What client-facing reporting means:
	 *  absence and unfiled have no client to group under. */
	| "project"
	/** Worked time with no project YET — a synced meeting, a commit fill block,
	 *  an accepted day-assembly suggestion. Real work, not yet attributed, and
	 *  therefore a to-do: this scope feeds the time page's nag and the guard that
	 *  stops a month being finalized while someone still owes an attribution.
	 *
	 *  Which is why the Break built-in is excluded. A break has no project and
	 *  never will — nobody bills a client for lunch — so counting it here nagged
	 *  people to file something unfileable and blocked the close on it. That was
	 *  already reachable through the day assembler's break suggestion; a daily
	 *  recurring break block made it every working day of the month. */
	| "unfiled"
	/** Vacation and Sick Leave. Never counted as worked time. */
	| "absence"
	/** No classification filter. */
	| "all";

export type LedgerFilter = {
	clientId?: string;
	projectId?: string;
	projectIds?: string[];
	taskId?: string;
	userId?: string;
	userIds?: string[];
	/** Restrict to overtime rows. Absent means "both". */
	overtimeOnly?: boolean;
	/** Access scope: the project ids the caller may see, or null for unscoped
	 *  (admins). An empty array means "nothing", and is honoured as such. */
	visibleProjectIds?: string[] | null;
};

/** Whether a scope needs the `task` table joined to be evaluated. Callers
 *  building their own select must add `.innerJoin(task, ...)` when true. */
export const scopeNeedsTaskJoin = (scope: LedgerScope): boolean =>
	scope === "worked" || scope === "unfiled" || scope === "absence";

/** Whether a scope needs the `project` table joined. Only client filtering does. */
export const filterNeedsProjectJoin = (filter: LedgerFilter): boolean =>
	filter.clientId != null;

const scopePredicate = (scope: LedgerScope): SQL | undefined => {
	switch (scope) {
		case "worked":
			return eq(task.isAbsence, false);
		case "project":
			// Absence never carries a project, so "has a project" already excludes
			// it — no task join needed for this scope.
			return isNotNull(timeEntry.projectId);
		case "unfiled":
			// `is distinct from` rather than `!=`: system_key is null on every
			// ordinary task, and null != 'break' is null, which would drop the whole
			// unfiled category on the floor.
			return and(
				isNull(timeEntry.projectId),
				eq(task.isAbsence, false),
				sql`${task.systemKey} is distinct from 'break'`,
			);
		case "absence":
			return eq(task.isAbsence, true);
		case "all":
			return undefined;
	}
};

/** The one predicate. Tenancy, range, classification and access scope.
 *
 *  Exported so callers with a bespoke projection compose it instead of
 *  rewriting `eq(org), gte(date, from), lte(date, to)` — which appeared at
 *  eight sites, one of them as raw sql`` rather than drizzle helpers, and one of
 *  which omitted the organization predicate entirely and leaned on the FK. */
export const ledgerWhere = (
	ctx: Ctx,
	range: DateRange,
	scope: LedgerScope,
	filter: LedgerFilter = {},
): SQL | undefined =>
	and(
		eq(timeEntry.organizationId, ctx.organizationId),
		gte(timeEntry.date, range.from),
		lte(timeEntry.date, range.to),
		scopePredicate(scope),
		filter.visibleProjectIds
			? inArray(timeEntry.projectId, filter.visibleProjectIds)
			: undefined,
		filter.projectId ? eq(timeEntry.projectId, filter.projectId) : undefined,
		filter.projectIds ? inArray(timeEntry.projectId, filter.projectIds) : undefined,
		filter.clientId ? eq(project.clientId, filter.clientId) : undefined,
		filter.taskId ? eq(timeEntry.taskId, filter.taskId) : undefined,
		filter.userId ? eq(timeEntry.userId, filter.userId) : undefined,
		filter.userIds ? inArray(timeEntry.userId, filter.userIds) : undefined,
		filter.overtimeOnly ? eq(timeEntry.overtime, true) : undefined,
	);

const SECONDS = sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`;

/** Total seconds in a range for a scope. */
export const ledgerTotal = async (
	ctx: Ctx,
	range: DateRange,
	scope: LedgerScope,
	filter: LedgerFilter = {},
): Promise<number> => {
	let q = db.select({ seconds: SECONDS }).from(timeEntry).$dynamic();
	if (scopeNeedsTaskJoin(scope)) {
		q = q.innerJoin(task, eq(timeEntry.taskId, task.id));
	}
	if (filterNeedsProjectJoin(filter)) {
		q = q.innerJoin(project, eq(timeEntry.projectId, project.id));
	}
	const [row] = await q.where(ledgerWhere(ctx, range, scope, filter));
	return Number(row?.seconds ?? 0);
};

/** Seconds per user in a range for a scope, keyed by userId.
 *
 *  Users with no rows are absent from the map rather than present as 0 — the
 *  three call sites this replaces all read it through `?? 0`, and materialising
 *  a zero row would require knowing the cohort, which is the caller's business. */
export const ledgerByUser = async (
	ctx: Ctx,
	range: DateRange,
	scope: LedgerScope,
	filter: LedgerFilter = {},
): Promise<Map<string, number>> => {
	let q = db
		.select({ userId: timeEntry.userId, seconds: SECONDS })
		.from(timeEntry)
		.$dynamic();
	if (scopeNeedsTaskJoin(scope)) {
		q = q.innerJoin(task, eq(timeEntry.taskId, task.id));
	}
	if (filterNeedsProjectJoin(filter)) {
		q = q.innerJoin(project, eq(timeEntry.projectId, project.id));
	}
	const rows = await q
		.where(ledgerWhere(ctx, range, scope, filter))
		.groupBy(timeEntry.userId);
	return new Map(rows.map((r) => [r.userId, Number(r.seconds)]));
};

/** Seconds per project in a range for a scope, keyed by projectId.
 *
 *  Rows with no project are dropped rather than bucketed under "" — the close
 *  overview used to fold all unfiled time into an empty-string key, where it
 *  read as a project total belonging to nothing. Ask for the `unfiled` scope
 *  explicitly if that time is what you want. */
export const ledgerByProject = async (
	ctx: Ctx,
	range: DateRange,
	scope: LedgerScope,
	filter: LedgerFilter = {},
): Promise<Map<string, number>> => {
	let q = db
		.select({ projectId: timeEntry.projectId, seconds: SECONDS })
		.from(timeEntry)
		.$dynamic();
	if (scopeNeedsTaskJoin(scope)) {
		q = q.innerJoin(task, eq(timeEntry.taskId, task.id));
	}
	if (filterNeedsProjectJoin(filter)) {
		q = q.innerJoin(project, eq(timeEntry.projectId, project.id));
	}
	const rows = await q
		.where(ledgerWhere(ctx, range, scope, filter))
		.groupBy(timeEntry.projectId);
	const out = new Map<string, number>();
	for (const r of rows) {
		if (!r.projectId) continue;
		out.set(r.projectId, Number(r.seconds));
	}
	return out;
};
