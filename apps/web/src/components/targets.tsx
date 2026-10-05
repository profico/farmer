import { formatReportHours } from "@farmer/core/lib/report-format";
import type { PeriodTarget, TrackingStatus } from "@farmer/core/services";
import { useQuery } from "@tanstack/react-query";

import { StatusPill } from "#/components/status-pill.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Of, StatTile, StatTiles } from "#/components/ui/stat-tile.tsx";
import { cn } from "#/lib/utils.ts";
import { myTargetsQuery } from "#/queries/compliance.ts";

// A person's own targets — this week and this month — as the home page and
// the timesheet show them. The rule is the Tracking rule (8h a working day,
// public holidays out, time-off counts), read for one person: the figure as
// logged / target, a meter carrying the verdict, and one sentence saying what
// is missing. Same words and colors as the Tracking report, so what a person
// reads here is what their lead reads there.
//
// `TargetBlock` and `TargetBar` lived here too — the home page's stacked
// blocks, each with a rail and a "today" tick. The home page shows all three
// periods as `StatTile`s now (`components/ui/stat-tile.tsx`) and nothing else
// ever used them, so they are gone rather than kept as a second way to draw
// the same number.

/** A verdict as a tile's meter color. Same three words as the pill, so the
 *  color and the label can never disagree. */
export const TARGET_TONE = {
	on_track: "ok",
	slightly_behind: "warn",
	behind: "bad",
} as const satisfies Record<TrackingStatus, "ok" | "warn" | "bad">;

export const TARGET_STATUS = {
	on_track: { label: "On track", tone: "positive" },
	slightly_behind: { label: "Slightly behind", tone: "warning" },
	behind: { label: "Behind", tone: "negative" },
} as const satisfies Record<
	TrackingStatus,
	{ label: string; tone: "positive" | "warning" | "negative" }
>;

/** The color of the gap. Ahead is green. Short follows the verdict, and the
 *  verdict does not count today's own working day, so a person who is short
 *  only by hours of today that are not yet over has no color: the day is still
 *  in progress, and red would contradict the "On track" pill beside it. */
export function targetGapTone(period: PeriodTarget, delta: number) {
	if (delta >= 0) return "text-ok";
	if (period.status === "slightly_behind") return "text-warn";
	if (period.status === "behind") return "text-bad";
	return "text-foreground";
}

/** "5,00 short of the 32,00 due by the end of today", or "1,50 ahead of the
 *  32,00 due by the end of today". The number is the goal through the end of
 *  today, so it includes today's own working day: on a Monday it is one day,
 *  not 0. "Today's" is not used, because people read it two ways: the hours
 *  due before today, or the hours due through today. The hours logged are
 *  work + time off through today, never a day booked off later in the
 *  period. With nothing logged yet it reads "0,00 of the 32,00 due by the
 *  end of today", with no color: "short" before the day starts reads badly. */
export function TargetGap({ period }: { period: PeriodTarget }) {
	if (period.targetSoFarSeconds == null) {
		return <span className="text-muted-foreground">No target</span>;
	}
	const goal = period.targetThroughTodaySeconds ?? period.targetSoFarSeconds;
	if (period.totalSoFarSeconds === 0 && goal > 0) {
		return (
			<span className="text-muted-foreground">
				{formatReportHours(0)} of the {formatReportHours(goal)} due by the end
				of today
			</span>
		);
	}
	const delta = period.totalSoFarSeconds - goal;
	return (
		<span className="text-muted-foreground">
			<span className={cn("font-medium", targetGapTone(period, delta))}>
				{formatReportHours(Math.abs(delta))} {delta >= 0 ? "ahead" : "short"}
			</span>{" "}
			of the {formatReportHours(goal)} due by the end of today
		</span>
	);
}

function Pill({ status }: { status: TrackingStatus | null }) {
	if (!status) {
		return <span className="text-xs text-muted-foreground">No target</span>;
	}
	const s = TARGET_STATUS[status];
	return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}

/**
 * The timesheet's two targets, in the same tiles the home page uses.
 *
 * It was a bespoke strip of its own: an eyebrow, a figure, a pill, a rail and
 * a sentence crammed onto one line, in type sizes that existed nowhere else. So
 * the same two numbers were set two different ways on two screens a tab apart.
 * They are `StatTile`s now, which means one component to tune and one look to
 * recognise.
 *
 * Read without suspending, so the timesheet never waits on it.
 */
export function TargetsStrip({ orgSlug }: { orgSlug: string }) {
	const { data } = useQuery(myTargetsQuery(orgSlug));
	const cells = [
		{ key: "week", title: "This week", period: data?.week },
		{ key: "month", title: "This month", period: data?.month },
	] as const;
	return (
		<StatTiles columns={2} className="mt-5 shrink-0">
			{cells.map(({ key, title, period }) => (
				<StatTile
					key={key}
					label={title}
					aside={period?.status && <Pill status={period.status} />}
					percent={
						period?.targetSeconds
							? (period.totalSeconds / period.targetSeconds) * 100
							: null
					}
					tone={period?.status ? TARGET_TONE[period.status] : "neutral"}
					value={
						period ? (
							<>
								{formatReportHours(period.totalSeconds)}
								{period.targetSeconds != null && (
									<Of>/ {formatReportHours(period.targetSeconds)}</Of>
								)}
							</>
						) : (
							<Skeleton className="h-6 w-28" />
						)
					}
					caption={period ? <TargetGap period={period} /> : null}
				/>
			))}
		</StatTiles>
	);
}
