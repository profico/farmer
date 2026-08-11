// What "utilization" means, stated once.
//
// The per-person figure was never in dispute:
//
//     utilization = Final hours on non-internal projects / Expected hours
//
// The ORG-WIDE figure was. Three places computed it and no two agreed:
//
//   * the utilization trend averaged the per-person percentages (mean of ratios),
//   * the reports screen re-implemented that same average by hand,
//   * the PDF headline divided total Final by total Expected (ratio of sums),
//     and summed Final over EVERY row while summing Expected only over the rows
//     that had one — so a contractor with no Expected figure added hours to the
//     numerator that no denominator ever balanced.
//
// A mean of ratios weights a half-time person exactly as heavily as a full-time
// one, so one person at 20% of a tiny fund moves the org number as much as five
// full-timers. The org figure is a ratio of sums, over MEASURED people only:
// someone with no Expected figure has no utilization, and half-counting them
// (hours in, denominator out) inflates the number rather than skipping it. This
// is the same intent the trend's own comment stated and the PDF's arithmetic
// contradicted.

/** The part of a utilization row this module needs. The service's row carries
 *  name/type/userId too; nothing here depends on them. */
export type UtilizationRow = {
	finalSeconds: number;
	expectedSeconds: number | null;
};

export type UtilizationTotals = {
	/** How many people had an Expected figure at all. The org percentage is over
	 *  these people only, so it is reported next to it rather than left implicit. */
	peopleMeasured: number;
	/** Final hours across every row, measured or not — the "Final hours" headline
	 *  is a total of work done, not a numerator. */
	finalSeconds: number;
	/** The numerator: Final hours belonging to measured people. */
	measuredFinalSeconds: number;
	/** The denominator. */
	expectedSeconds: number;
	/** null when nobody in the period had an Expected figure. */
	utilizationPct: number | null;
};

/** True when this row has a denominator to divide by. A contractor with no
 *  explicit expected value is unmeasured, not zero. */
export const isMeasured = (row: UtilizationRow): boolean =>
	row.expectedSeconds != null && row.expectedSeconds > 0;

/** One person's percentage, or null when there is nothing to divide by. */
export const utilizationPctOf = (
	finalSeconds: number,
	expectedSeconds: number | null,
): number | null =>
	expectedSeconds != null && expectedSeconds > 0
		? Math.round((finalSeconds / expectedSeconds) * 100)
		: null;

/** The org-wide figure for a set of rows — the screen headline, the trend point
 *  and the PDF summary all read it from here. */
export const rollUpUtilization = (
	rows: readonly UtilizationRow[],
): UtilizationTotals => {
	let finalSeconds = 0;
	let measuredFinalSeconds = 0;
	let expectedSeconds = 0;
	let peopleMeasured = 0;

	for (const row of rows) {
		finalSeconds += row.finalSeconds;
		if (!isMeasured(row)) continue;
		peopleMeasured += 1;
		measuredFinalSeconds += row.finalSeconds;
		expectedSeconds += row.expectedSeconds ?? 0;
	}

	return {
		peopleMeasured,
		finalSeconds,
		measuredFinalSeconds,
		expectedSeconds,
		utilizationPct: utilizationPctOf(measuredFinalSeconds, expectedSeconds),
	};
};
