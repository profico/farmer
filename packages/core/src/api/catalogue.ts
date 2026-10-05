/**
 * The lists a person picks from when they log time: their projects and the
 * tasks. Projections for the same reason as `time-entries.ts` — a project row
 * carries budgets, prices and stats that a CLI has no use for and must not
 * start depending on.
 */

import type { PeriodTarget } from "../services/compliance.service";
import type { ApiProjectRole } from "./me";

/** `GET /api/v1/orgs/$slug/projects` — the projects the caller may log to. */
export type ApiProject = {
	id: string;
	name: string;
	code: string | null;
	status: string;
	client: { id: string; name: string };
	role: ApiProjectRole | null;
};

export const toApiProject = (row: {
	id: string;
	name: string;
	code: string | null;
	status: string;
	client: { id: string; name: string };
	myRole: ApiProjectRole | null;
}): ApiProject => ({
	id: row.id,
	name: row.name,
	code: row.code,
	status: row.status,
	client: { id: row.client.id, name: row.client.name },
	role: row.myRole,
});

export type ApiTask = {
	id: string;
	name: string;
	group: string;
	isAbsence: boolean;
	systemKey: string | null;
};

export const toApiTask = (row: {
	id: string;
	name: string;
	group: string;
	isAbsence: boolean;
	systemKey: string | null;
}): ApiTask => ({
	id: row.id,
	name: row.name,
	group: row.group,
	isAbsence: row.isAbsence,
	systemKey: row.systemKey,
});

/** `GET /api/v1/orgs/$slug/tasks`. Two lists, because they feed two different
 *  commands: `log` takes a work task, `off` takes an absence task. */
export type ApiTaskList = { tasks: ApiTask[]; absenceTasks: ApiTask[] };

export type ApiPeriod = {
	from: string;
	to: string;
	workingDays: number;
	workingDaysElapsed: number;
	workingDaysThroughToday: number;
	targetSeconds: number | null;
	targetSoFarSeconds: number | null;
	targetThroughTodaySeconds: number | null;
	workSeconds: number;
	timeOffSeconds: number;
	totalSeconds: number;
	totalSoFarSeconds: number;
	/** Null when no target applies to the person (hourly, overhead). */
	status: PeriodTarget["status"];
};

export const toApiPeriod = (period: PeriodTarget): ApiPeriod => ({
	from: period.from,
	to: period.to,
	workingDays: period.workingDays,
	workingDaysElapsed: period.workingDaysElapsed,
	workingDaysThroughToday: period.workingDaysThroughToday,
	targetSeconds: period.targetSeconds,
	targetSoFarSeconds: period.targetSoFarSeconds,
	targetThroughTodaySeconds: period.targetThroughTodaySeconds,
	workSeconds: period.workSeconds,
	timeOffSeconds: period.timeOffSeconds,
	totalSeconds: period.totalSeconds,
	totalSoFarSeconds: period.totalSoFarSeconds,
	status: period.status,
});

/** `GET /api/v1/orgs/$slug/tracking` — `farmer status`. The caller's own week
 *  and month against the Tracking rule, the same figures the home page shows. */
export type ApiTracking = {
	today: string;
	daySeconds: number;
	tolerancePct: number;
	week: ApiPeriod;
	month: ApiPeriod;
};

/** `POST /api/v1/orgs/$slug/sync` — which engines ran. See
 *  `runAutomationsForUser` for what each list means.
 *
 *  `stillRunning` is the deadline case, as for "Sync now" in the web app: the
 *  pass took longer than the request may stay open and keeps going on the
 *  server. The four lists are then empty because nothing is KNOWN yet, not
 *  because nothing happened. */
export type ApiSyncResult = {
	stillRunning: boolean;
	ran: string[];
	skipped: string[];
	failed: string[];
	off: string[];
};
