import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");
const year = z.number().int().min(2000).max(2100);
const month = z.number().int().min(1).max(12);

export const timeReportTab = z.enum(["clients", "projects", "teammates"]);
export type TimeReportTab = z.infer<typeof timeReportTab>;

const range = {
	from: dateKey,
	to: dateKey,
};

const filters = {
	clientId: z.uuid().optional(),
	projectId: z.uuid().optional(),
	taskId: z.uuid().optional(),
	userId: z.string().min(1).optional(),
};

export const timeReportSummaryInput = z
	.object({ ...range, tab: timeReportTab, ...filters })
	.refine((d) => d.from <= d.to, {
		message: "from must not be after to",
		path: ["to"],
	});
export type TimeReportSummaryInput = z.infer<typeof timeReportSummaryInput>;

export const timeReportDetailInput = z
	.object({
		...range,
		...filters,
		// The project drill-down offers a group-by toggle: person or date.
		groupBy: z.enum(["date", "person"]).default("date"),
	})
	.refine((d) => d.from <= d.to, {
		message: "from must not be after to",
		path: ["to"],
	});
export type TimeReportDetailInput = z.infer<typeof timeReportDetailInput>;

export const monthReportInput = z.object({ year, month });
export type MonthReportInput = z.infer<typeof monthReportInput>;

// The drill-down behind one person's overtime figure.
export const overtimeDetailInput = z.object({
	year,
	month,
	userId: z.string().min(1),
});
export type OvertimeDetailInput = z.infer<typeof overtimeDetailInput>;

export const yearReportInput = z.object({ year });
export type YearReportInput = z.infer<typeof yearReportInput>;

export const absenceReportInput = z.object({
	year,
	// Absent = the whole year to date, which is how the report is read.
	month: month.optional(),
});
export type AbsenceReportInput = z.infer<typeof absenceReportInput>;

export const varianceTrendInput = z.object({
	year,
	// How many months back from (year, month) to include in the trend.
	months: z.number().int().min(1).max(24).default(6),
	month,
});
export type VarianceTrendInput = z.infer<typeof varianceTrendInput>;

export const utilizationTrendInput = varianceTrendInput;
export type UtilizationTrendInput = z.infer<typeof utilizationTrendInput>;
