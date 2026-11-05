/**
 * The four Reports tabs, as the REST API answers them.
 *
 * The services already limit each report to the caller's scope: an Admin sees
 * everybody, a PM their projects, a Team Lead their people and their
 * projects, and a Member only their own time. The projections do not widen or
 * narrow that. They pick each field by name, so a field that a service adds
 * later does not become part of the contract.
 */

import type { TrackingReport } from "../services/compliance.service";
import type {
	AbsenceReport,
	OvertimeReport,
	TimeReportDetail,
	TimeReportRow,
} from "../services/reports.service";

/** One row of `GET …/reports/time`: a client, a project or a person, by the
 *  `tab` that was asked for. */
export type ApiTimeReportRow = {
	id: string;
	name: string;
	secondsTotal: number;
	/** The teammates tab only: time off in the period. Zero on the others. */
	timeOffSeconds: number;
	/** Clients: projects with time. Projects: people with time. Teammates:
	 *  projects the person logged on. */
	count: number;
	/** The projects tab only. */
	clientName: string | null;
	code: string | null;
	archived: boolean;
};

/** `GET …/reports/time`. */
export type ApiTimeReport = {
	rows: ApiTimeReportRow[];
	totalSeconds: number;
	/** Worked time with no project yet, which the rows leave out. Only for an
	 *  unfiltered report over the whole organization; zero otherwise. */
	unfiledSeconds: number;
};

export const toApiTimeReport = (report: {
	rows: TimeReportRow[];
	totalSeconds: number;
	unfiledSeconds: number;
}): ApiTimeReport => ({
	rows: report.rows.map((row) => ({
		id: row.id,
		name: row.name,
		secondsTotal: row.secondsTotal,
		timeOffSeconds: row.timeOffSeconds,
		count: row.count,
		clientName: row.clientName,
		code: row.code,
		archived: row.archived,
	})),
	totalSeconds: report.totalSeconds,
	unfiledSeconds: report.unfiledSeconds,
});

/** One entry of `GET …/reports/time/detail`. */
export type ApiTimeReportEntry = {
	id: string;
	date: string;
	client: { id: string; name: string };
	project: { id: string; name: string; code: string | null };
	task: { id: string; name: string };
	description: string;
	user: { id: string; name: string };
	overtime: boolean;
	durationSeconds: number;
};

/** `GET …/reports/time/detail`. */
export type ApiTimeReportDetail = {
	rows: ApiTimeReportEntry[];
	/** The matching entries, also the ones past the cap. */
	totalRows: number;
	/** The sum over every matching entry, also the ones past the cap. */
	totalSeconds: number;
	/** True when the rows stop at the cap. */
	truncated: boolean;
};

export const toApiTimeReportDetail = (
	report: TimeReportDetail,
): ApiTimeReportDetail => ({
	rows: report.rows.map((row) => ({
		id: row.id,
		date: row.date,
		client: { id: row.clientId, name: row.clientName },
		project: {
			id: row.projectId,
			name: row.projectName,
			code: row.projectCode,
		},
		task: { id: row.taskId, name: row.taskName },
		description: row.description,
		user: { id: row.userId, name: row.userName },
		overtime: row.overtime,
		durationSeconds: row.durationSeconds,
	})),
	totalRows: report.totalRows,
	totalSeconds: report.totalSeconds,
	truncated: report.truncated,
});

/** `GET …/reports/overtime`. */
export type ApiOvertimeReport = {
	rows: {
		userId: string;
		name: string;
		/** Overtime entries in the period. */
		count: number;
		seconds: number;
		entries: {
			id: string;
			date: string;
			projectName: string;
			projectCode: string | null;
			taskName: string;
			description: string;
			durationSeconds: number;
		}[];
	}[];
	totalSeconds: number;
	totalEntries: number;
};

export const toApiOvertimeReport = (
	report: OvertimeReport,
): ApiOvertimeReport => ({
	rows: report.rows.map((row) => ({
		userId: row.userId,
		name: row.name,
		count: row.count,
		seconds: row.seconds,
		entries: row.entries.map((entry) => ({
			id: entry.id,
			date: entry.date,
			projectName: entry.projectName,
			projectCode: entry.projectCode,
			taskName: entry.taskName,
			description: entry.description,
			durationSeconds: entry.durationSeconds,
		})),
	})),
	totalSeconds: report.totalSeconds,
	totalEntries: report.totalEntries,
});

/** `GET …/reports/absence`. */
export type ApiAbsenceReport = {
	workingDaySeconds: number;
	/** One column for each absence task. `key` is the task's system key, or
	 *  its id for a task without one. */
	columns: { key: string; label: string }[];
	rows: {
		userId: string;
		name: string;
		seconds: number;
		/** Seconds for each column, by `key`. */
		byTask: Record<string, number>;
		entries: {
			id: string;
			date: string;
			taskKey: string;
			taskName: string;
			description: string;
			durationSeconds: number;
		}[];
	}[];
};

export const toApiAbsenceReport = (
	report: AbsenceReport,
): ApiAbsenceReport => ({
	workingDaySeconds: report.workingDaySeconds,
	columns: report.columns.map((column) => ({
		key: column.key,
		label: column.label,
	})),
	rows: report.rows.map((row) => ({
		userId: row.userId,
		name: row.name,
		seconds: row.seconds,
		byTask: { ...row.byTask },
		entries: row.entries.map((entry) => ({
			id: entry.id,
			date: entry.date,
			taskKey: entry.taskKey,
			taskName: entry.taskName,
			description: entry.description,
			durationSeconds: entry.durationSeconds,
		})),
	})),
});

/** `GET …/reports/tracking` — work and time off against the month's hour
 *  fund, for each person the caller may see. */
export type ApiTrackingReport = {
	year: number;
	month: number;
	/** The last day the figures cover. */
	asOf: string;
	complete: boolean;
	fundSeconds: number | null;
	workingDaysInMonth: number;
	workingDaysElapsed: number;
	targetSeconds: number | null;
	tolerancePct: number;
	rows: {
		userId: string;
		name: string;
		email: string;
		memberType: string;
		workSeconds: number;
		timeOffSeconds: number;
		totalSeconds: number;
		targetSeconds: number | null;
		monthTargetSeconds: number | null;
		deltaSeconds: number | null;
		status: "on_track" | "slightly_behind" | "behind" | null;
	}[];
};

export const toApiTrackingReport = (
	report: TrackingReport,
): ApiTrackingReport => ({
	year: report.year,
	month: report.month,
	asOf: report.asOf,
	complete: report.complete,
	fundSeconds: report.fundSeconds,
	workingDaysInMonth: report.workingDaysInMonth,
	workingDaysElapsed: report.workingDaysElapsed,
	targetSeconds: report.targetSeconds,
	tolerancePct: report.tolerancePct,
	rows: report.rows.map((row) => ({
		userId: row.userId,
		name: row.name,
		email: row.email,
		memberType: row.memberType,
		workSeconds: row.workSeconds,
		timeOffSeconds: row.timeOffSeconds,
		totalSeconds: row.totalSeconds,
		targetSeconds: row.targetSeconds,
		monthTargetSeconds: row.monthTargetSeconds,
		deltaSeconds: row.deltaSeconds,
		status: row.status,
	})),
});

/** `GET …/absences?year&month` — the caller's own time off in one month. */
export type ApiAbsenceEntry = {
	id: string;
	date: string;
	task: { id: string; name: string };
	description: string;
	durationSeconds: number;
};

export const toApiAbsenceEntry = (row: {
	id: string;
	date: string;
	taskId: string;
	taskName: string;
	description: string;
	durationSeconds: number;
}): ApiAbsenceEntry => ({
	id: row.id,
	date: row.date,
	task: { id: row.taskId, name: row.taskName },
	description: row.description,
	durationSeconds: row.durationSeconds,
});
