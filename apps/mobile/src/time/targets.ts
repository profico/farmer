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

/** "1:30 short of today's 24:00", from what is logged through today. */
export const targetGap = (period: Period) => {
	if (period.targetSoFarSeconds == null) return null;
	const delta = period.totalSoFarSeconds - period.targetSoFarSeconds;
	return {
		ahead: delta >= 0,
		text: `${formatHours(Math.abs(delta))} ${delta >= 0 ? "ahead of" : "short of"} today's ${formatHours(period.targetSoFarSeconds)}`,
	};
};

/** The part of the target that is logged, 0 to 1, or null with no target. */
export const targetProgress = (period: Period) =>
	period.targetSeconds ? period.totalSeconds / period.targetSeconds : null;
