import { formatReportHours } from "@farmer/core/lib/report-format";
import type { PeriodTarget, TrackingStatus } from "@farmer/core/services";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { StatusPill } from "#/components/status-pill.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { cn } from "#/lib/utils.ts";
import { myTargetsQuery } from "#/queries/compliance.ts";

// A person's own targets — this week and this month — as the home page and
// the timesheet show them. The rule is the Tracking rule (8h a working day,
// public holidays out, time-off counts), read for one person: the figure as
// logged / target, a rail with a tick at "today", and one sentence saying
// what is missing. Same words and colours as the Tracking report, so what a
// person reads here is what their lead reads there.

export const TARGET_STATUS = {
	on_track: { label: "On track", tone: "positive" },
	slightly_behind: { label: "Slightly behind", tone: "warning" },
	behind: { label: "Behind", tone: "negative" },
} as const satisfies Record<
	TrackingStatus,
	{ label: string; tone: "positive" | "warning" | "negative" }
>;

/** "5,00 short of today's 24,00", or "1,50 ahead of today's 24,00". */
export function TargetGap({ period }: { period: PeriodTarget }) {
	if (period.targetSoFarSeconds == null) {
		return <span className="text-muted-foreground">No target</span>;
	}
	const delta = period.totalSeconds - period.targetSoFarSeconds;
	return (
		<span className="text-muted-foreground">
			<span
				className={cn(
					"font-medium",
					delta >= 0
						? "text-ok"
						: period.status === "slightly_behind"
							? "text-warn"
							: "text-bad",
				)}
			>
				{formatReportHours(Math.abs(delta))} {delta >= 0 ? "ahead" : "short"}
			</span>{" "}
			of today's {formatReportHours(period.targetSoFarSeconds)}
		</span>
	);
}

/** The rail: what is logged as the fill, "today" as a tick, the period's
 *  whole target as the length. The app's one progress indicator, with the
 *  tick added — without it a half-full bar says nothing about whether half
 *  full is fine. */
export function TargetBar({
	period,
	className,
	labelled = false,
}: {
	period: PeriodTarget;
	className?: string;
	/** Write "today" under the tick. */
	labelled?: boolean;
}) {
	if (period.targetSeconds == null || period.targetSeconds === 0) return null;
	const fill = Math.min(
		100,
		(period.totalSeconds / period.targetSeconds) * 100,
	);
	const tick = Math.min(
		100,
		((period.targetSoFarSeconds ?? 0) / period.targetSeconds) * 100,
	);
	return (
		<div className={cn("relative h-1.5 rounded-full bg-secondary", className)}>
			<span
				className={cn(
					"absolute inset-y-0 left-0 rounded-full",
					period.status === "behind"
						? "bg-bad"
						: period.status === "slightly_behind"
							? "bg-warn"
							: "bg-primary",
				)}
				style={{ width: `${fill}%` }}
			/>
			<span
				aria-hidden
				className="absolute -inset-y-1 w-0.5 rounded-sm bg-foreground"
				style={{ left: `calc(${tick}% - 1px)` }}
			>
				{labelled && (
					<span className="eyebrow absolute top-4 left-1/2 -translate-x-1/2 text-[10px]">
						today
					</span>
				)}
			</span>
		</div>
	);
}

function Pill({ status }: { status: TrackingStatus | null }) {
	if (!status) {
		return <span className="text-xs text-muted-foreground">No target</span>;
	}
	const s = TARGET_STATUS[status];
	return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}

/** One of the home page's two blocks. */
export function TargetBlock({
	title,
	period,
	note,
	className,
}: {
	title: string;
	period: PeriodTarget;
	/** Appended to the sentence — the month's working-days count. */
	note?: ReactNode;
	className?: string;
}) {
	const toGo =
		period.targetSeconds == null
			? null
			: Math.max(0, period.targetSeconds - period.totalSeconds);
	return (
		<div className={cn("border-b px-4 py-4 sm:px-8", className)}>
			<div className="flex items-center justify-between gap-3">
				<div className="eyebrow">{title}</div>
				<Pill status={period.status} />
			</div>
			<div className="mono mt-1.5 text-xl">
				{formatReportHours(period.totalSeconds)}
				{period.targetSeconds != null && (
					<span className="text-sm text-muted-foreground">
						{" "}
						/ {formatReportHours(period.targetSeconds)}
					</span>
				)}
			</div>
			<p className="mt-0.5 text-sm">
				<TargetGap period={period} />
				{toGo != null && (
					<span className="text-muted-foreground">
						{" "}
						·{" "}
						<span className="font-medium text-foreground">
							{formatReportHours(toGo)}
						</span>{" "}
						to go
					</span>
				)}
				{note}
			</p>
			<TargetBar period={period} className="mt-3 mb-5" labelled />
		</div>
	);
}

/** The slim strip under the timesheet's Day · Week · Month tabs: the same two
 *  figures, above the entries being filled in. Read without suspending, so
 *  the timesheet never waits on it. */
export function TargetsStrip({ orgSlug }: { orgSlug: string }) {
	const { data } = useQuery(myTargetsQuery(orgSlug));
	const cells = [
		{ key: "week", title: "This week", period: data?.week },
		{ key: "month", title: "This month", period: data?.month },
	] as const;
	return (
		<div className="-mx-4 mt-5 grid shrink-0 border-y sm:-mx-8 sm:grid-cols-2 sm:divide-x">
			{cells.map(({ key, title, period }) => (
				<div key={key} className="px-4 py-3 sm:px-8">
					<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span className="eyebrow">{title}</span>
						{period ? (
							<>
								<span className="mono text-sm font-medium">
									{formatReportHours(period.totalSeconds)}
									{period.targetSeconds != null && (
										<span className="font-normal text-muted-foreground">
											{" "}
											/ {formatReportHours(period.targetSeconds)}
										</span>
									)}
								</span>
								{period.status && <Pill status={period.status} />}
								<span className="text-sm">
									<TargetGap period={period} />
								</span>
							</>
						) : (
							<Skeleton className="h-4 w-48" />
						)}
					</div>
					{period ? (
						<TargetBar period={period} className="mt-2 h-1" />
					) : (
						<div className="mt-2 h-1" />
					)}
				</div>
			))}
		</div>
	);
}
