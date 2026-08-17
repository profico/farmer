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

// The widest span a range report may cover.
//
// `from <= to` was the only constraint, so `2000-01-01 → 2099-12-31` was a
// request any Team Lead could make and the server would answer by scanning and
// grouping the entire entry table. The month and week presets are bounded by
// construction; Custom is free text and is what needed a ceiling.
//
// 366 rather than something tighter because a full calendar year — including a
// leap year — is a report somebody genuinely runs. This is a backstop against
// the pathological case, not an opinion about how people should slice time.
const MAX_REPORT_SPAN_DAYS = 366;

const spanWithinLimit = (data: { from: string; to: string }) => {
	const from = new Date(`${data.from}T00:00:00Z`).getTime();
	const to = new Date(`${data.to}T00:00:00Z`).getTime();
	return (to - from) / 86_400_000 <= MAX_REPORT_SPAN_DAYS;
};

/** `from <= to`, and no wider than a year. Applied to every range-based report
 *  so the two rules cannot drift apart between the summary and the detail. */
const withRangeLimits = <T extends z.ZodType<{ from: string; to: string }>>(
	schema: T,
) =>
	schema
		.refine((d) => d.from <= d.to, {
			message: "from must not be after to",
			path: ["to"],
		})
		.refine(spanWithinLimit, {
			message: `Range too large (max ${MAX_REPORT_SPAN_DAYS} days)`,
			path: ["to"],
		});

const filters = {
	clientId: z.uuid().optional(),
	projectId: z.uuid().optional(),
	taskId: z.uuid().optional(),
	userId: z.string().min(1).optional(),
};

export const timeReportSummaryInput = withRangeLimits(
	z.object({ ...range, tab: timeReportTab, ...filters }),
);
export type TimeReportSummaryInput = z.infer<typeof timeReportSummaryInput>;

export const timeReportDetailInput = withRangeLimits(
	z.object({
		...range,
		...filters,
		// The project drill-down offers a group-by toggle: person or date.
		groupBy: z.enum(["date", "person"]).default("date"),
	}),
);
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
