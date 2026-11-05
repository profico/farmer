// The report projections, for the reason `time-entries.test.ts` gives. The
// scope of each report is the service's, and `services/reports.test.ts` and
// `services/compliance.test.ts` pin it. Here the point is only that a field a
// service adds later does not go out by itself.

import { describe, expect, test } from "bun:test";

import {
	toApiAbsenceEntry,
	toApiAbsenceReport,
	toApiTimeReportDetail,
	toApiTrackingReport,
} from "./reports";

describe("toApiTimeReportDetail", () => {
	test("keeps exactly the fields it names, and groups the references", () => {
		const row = {
			id: "e-1",
			date: "2026-09-14",
			clientId: "c-1",
			clientName: "Acme",
			projectId: "p-1",
			projectName: "Apollo",
			projectCode: null,
			taskId: "t-1",
			taskName: "Development",
			description: "work",
			userId: "u-1",
			userName: "Ana",
			overtime: false,
			durationSeconds: 3600,
			userEmail: "ana@example.com",
		};
		const report = {
			rows: [row],
			totalRows: 1,
			totalSeconds: 3600,
			truncated: false,
		};
		expect(toApiTimeReportDetail(report)).toStrictEqual({
			rows: [
				{
					id: "e-1",
					date: "2026-09-14",
					client: { id: "c-1", name: "Acme" },
					project: { id: "p-1", name: "Apollo", code: null },
					task: { id: "t-1", name: "Development" },
					description: "work",
					user: { id: "u-1", name: "Ana" },
					overtime: false,
					durationSeconds: 3600,
				},
			],
			totalRows: 1,
			totalSeconds: 3600,
			truncated: false,
		});
	});
});

describe("toApiAbsenceReport", () => {
	test("copies the per-task seconds", () => {
		const report = {
			workingDaySeconds: 28_800,
			columns: [{ key: "vacation", label: "Vacation" }],
			rows: [
				{
					userId: "u-1",
					name: "Ana",
					seconds: 28_800,
					byTask: { vacation: 28_800 },
					entries: [],
				},
			],
		};
		const projected = toApiAbsenceReport(report);
		expect(projected).toStrictEqual(report);
		expect(projected.rows[0]?.byTask).not.toBe(report.rows[0]?.byTask);
	});
});

describe("toApiTrackingReport", () => {
	test("keeps exactly the fields it names", () => {
		const row = {
			userId: "u-1",
			name: "Ana",
			email: "ana@example.com",
			memberType: "employee_billable" as const,
			workSeconds: 3600,
			timeOffSeconds: 0,
			totalSeconds: 3600,
			targetSeconds: 7200,
			monthTargetSeconds: 576_000,
			deltaSeconds: -3600,
			status: "behind" as const,
			expectedSecondsOverride: null,
		};
		const report = {
			year: 2026,
			month: 9,
			asOf: "2026-09-14",
			complete: false,
			fundSeconds: 576_000,
			workingDaysInMonth: 22,
			workingDaysElapsed: 9,
			targetSeconds: 259_200,
			tolerancePct: 5,
			rows: [row],
		};
		const { expectedSecondsOverride: _left, ...kept } = row;
		expect(toApiTrackingReport(report)).toStrictEqual({
			...report,
			rows: [kept],
		});
	});
});

describe("toApiAbsenceEntry", () => {
	test("keeps exactly the fields it names", () => {
		const row = {
			id: "e-1",
			date: "2026-09-14",
			taskId: "t-1",
			taskName: "Vacation",
			description: "",
			durationSeconds: 28_800,
			userId: "u-1",
		};
		expect(toApiAbsenceEntry(row)).toStrictEqual({
			id: "e-1",
			date: "2026-09-14",
			task: { id: "t-1", name: "Vacation" },
			description: "",
			durationSeconds: 28_800,
		});
	});
});
