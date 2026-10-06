import type { Period } from "@farmer/api-client";

import { formatHours } from "../lib/duration";

/**
 * The person's targets for this week and this month, as the Tracking rule
 * reads them. The words are the web's (`components/targets.tsx`), so a
 * person reads here what their lead reads in the report.
 */

export type TargetTone = "good" | "warning" | "bad" | "neutral";

export const targetStatus = (
	status: string | null,
): { label: string; tone: TargetTone } | null => {
	switch (status) {
		case "on_track":
			return { label: "On track", tone: "good" };
		case "slightly_behind":
			return { label: "Slightly behind", tone: "warning" };
		case "behind":
			return { label: "Behind", tone: "bad" };
		default:
			return null;
	}
};

/**
 * The color of the gap, as `targetGapTone` on the web: ahead is good, and a
 * gap that is short takes the color of the status. A gap that is short only
 * by the hours of today has no color, because the day is not over.
 */
const gapTone = (status: string | null, delta: number): TargetTone => {
	if (delta >= 0) return "good";
	if (status === "slightly_behind") return "warning";
	if (status === "behind") return "bad";
	return "neutral";
};

/**
 * "1:30 short of the 24:00 due by the end of today". The goal includes the
 * working day of today, so on a Monday it is one day, not 0. Without
 * `targetThroughTodaySeconds`, the goal is the target before today.
 */
export const targetGap = (period: Period) => {
	if (period.targetSoFarSeconds == null) return null;
	const goal = period.targetThroughTodaySeconds ?? period.targetSoFarSeconds;
	const delta = period.totalSoFarSeconds - goal;
	return {
		ahead: delta >= 0,
		tone: gapTone(period.status, delta),
		text: `${formatHours(Math.abs(delta))} ${delta >= 0 ? "ahead of" : "short of"} the ${formatHours(goal)} due by the end of today`,
	};
};

/** The part of the target that is logged, 0 to 1, or null with no target. */
export const targetProgress = (period: Period) =>
	period.targetSeconds ? period.totalSeconds / period.targetSeconds : null;
