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
	/** "Active projects only": leave out time on archived projects. */
	activeOnly: z.boolean().optional(),
	/** Free text, matched against the note on each entry. Case-insensitive, and
	 *  a substring rather than a word, so "migra" finds "migration".
	 *
	 *  Shared with the summary on purpose: a total the caller cannot drill into
	 *  is worse than no total, so both halves of a report read one filter. */
	q: z.string().trim().min(1).max(200).optional(),
};

export const timeReportSummaryInput = withRangeLimits(
	z.object({ ...range, tab: timeReportTab, ...filters }),
);

export type TimeReportSummaryInput = z.infer<typeof timeReportSummaryInput>;

// No group-by here: the Breakdown groups the rows it has by any of five keys
// on the client, so the service returns them in one fixed order (date, then
// person) and never has to know which grouping is on screen.
export const timeReportDetailInput = withRangeLimits(
	z.object({ ...range, ...filters }),
);

export type TimeReportDetailInput = z.infer<typeof timeReportDetailInput>;

// Tracking is the one month-shaped report: its rule is a fraction of the month
// elapsed against the month's fund, and no other period has a fund.
export const monthReportInput = z.object({ year, month });

export type MonthReportInput = z.infer<typeof monthReportInput>;

export const yearReportInput = z.object({ year });

export type YearReportInput = z.infer<typeof yearReportInput>;

// Overtime and Absence take the same period as the Time report — every report
// shares the one period control — under the same ceiling.
export const overtimeReportInput = withRangeLimits(
	z.object({ ...range, activeOnly: z.boolean().optional() }),
);

export type OvertimeReportInput = z.infer<typeof overtimeReportInput>;

export const absenceReportInput = withRangeLimits(z.object({ ...range }));

export type AbsenceReportInput = z.infer<typeof absenceReportInput>;
