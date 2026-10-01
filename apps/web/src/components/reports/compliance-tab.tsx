import { formatReportHours } from "@farmer/core/lib/report-format";
import type { TrackingRow } from "@farmer/core/services";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";

import { MenuPath } from "#/components/menu-path.tsx";
import { PersonCell } from "#/components/person-avatar.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { formatDateKeyLong } from "#/lib/format-date.ts";
import { trackingReportQuery } from "#/queries/compliance.ts";

import {
	byNumber,
	byText,
	ReportTable,
	type Sort,
	toggleSort,
} from "./shared.tsx";

// Tracking (PRD 6.2, revised Sept 2026): one table, one rule. Each person's
// work + time-off against the month's hour fund prorated by the working days
// elapsed; on track, slightly behind (within the tolerance) or behind. The
// same verdicts drive the reminders, so what an admin reads here is exactly
// what a person was nudged about.
const STATUS_LABEL = {
	on_track: {
		live: "On track",
		done: "Met",
		tone: "positive",
		row: "",
	},
	slightly_behind: {
		live: "Slightly behind",
		done: "Just short",
		tone: "warning",
		row: "bg-warn/6 hover:bg-warn/10",
	},
	behind: {
		live: "Behind",
		done: "Short",
		tone: "negative",
		row: "bg-bad/6 hover:bg-bad/10",
	},
} as const;

const STATUS_RANK = { behind: 0, slightly_behind: 1, on_track: 2 } as const;

type SortKey =
	| "name"
	| "work"
	| "timeOff"
	| "total"
	| "target"
	| "delta"
	| "status";

// A person with no target has no target, no delta and no verdict, so on those
// three columns they sit at the bottom whichever way the column is sorted — a
// dash is not a small number.
const hasTarget = (r: TrackingRow) => r.targetSeconds != null;
const nullsLast = (a: TrackingRow, b: TrackingRow) =>
	Number(!hasTarget(a)) - Number(!hasTarget(b));

const COMPARE = {
	name: byText((r: TrackingRow) => r.name),
	work: byNumber((r: TrackingRow) => r.workSeconds),
	timeOff: byNumber((r: TrackingRow) => r.timeOffSeconds),
	total: byNumber((r: TrackingRow) => r.totalSeconds),
	target: byNumber((r: TrackingRow) => r.targetSeconds ?? 0),
	delta: byNumber((r: TrackingRow) => r.deltaSeconds ?? 0),
	status: byNumber((r: TrackingRow) => (r.status ? STATUS_RANK[r.status] : 3)),
} satisfies Record<SortKey, (a: TrackingRow, b: TrackingRow) => number>;

// Ahead is green, short is red, exactly on target is just the number:
// "+0" said the person was ahead by nothing, which is not a thing. Hours the
// way the accounting book writes them (1.821,50), like every report.
const Delta = ({ seconds }: { seconds: number }) => {
	if (seconds === 0) {
		return (
			<span className="text-muted-foreground">{formatReportHours(0)}</span>
		);
	}
	return (
		<span className={seconds > 0 ? "text-ok" : "text-bad"}>
			{seconds > 0 ? "+" : "−"}
			{formatReportHours(Math.abs(seconds))}
		</span>
	);
};

export function ComplianceTab({
	year,
	month,
}: {
	year: number;
	month: number;
}) {
	const orgSlug = useOrgSlug();
	const { data } = useSuspenseQuery(
		trackingReportQuery(orgSlug, { year, month }),
	);
	// The report arrives worst first (status, then the biggest shortfall);
	// that stays the default, and any column can take over — the delta column
	// is the one people asked for, to find who is furthest ahead or behind.
	const [sort, setSort] = useState<Sort<SortKey>>({ key: "status", dir: 1 });
	const onSort = (key: SortKey, numeric: boolean) =>
		setSort((current) => toggleSort(current, key, numeric));
	const rows = [...data.rows].sort(
		(a, b) =>
			(sort.key === "target" || sort.key === "delta" || sort.key === "status"
				? nullsLast(a, b)
				: 0) ||
			COMPARE[sort.key](a, b) * sort.dir ||
			(a.deltaSeconds ?? 0) - (b.deltaSeconds ?? 0) ||
			a.name.localeCompare(b.name, "hr"),
	);

	const counts = { behind: 0, slightly_behind: 0, on_track: 0 };
	for (const r of data.rows) if (r.status) counts[r.status] += 1;

	return (
		<div className="grid gap-6">
			{/* The three numbers the table is read against, before the table. */}
			<div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
				<div>
					<div className="eyebrow">Hour fund</div>
					<div className="mono mt-1 text-lg">
						{data.fundSeconds == null
							? "—"
							: formatReportHours(data.fundSeconds)}
					</div>
					{data.fundSeconds == null && (
						<div className="text-xs text-muted-foreground">
							Not set for this month —{" "}
							<MenuPath steps={["Settings", "Hour fund"]} />.
						</div>
					)}
				</div>
				<div>
					<div className="eyebrow">Target so far</div>
					<div className="mono mt-1 text-lg">
						{data.targetSeconds == null
							? "—"
							: formatReportHours(data.targetSeconds)}
					</div>
					<div className="text-xs text-muted-foreground">
						{data.workingDaysElapsed} of {data.workingDaysInMonth} working days
						{data.complete
							? ""
							: ` before today · as of ${formatDateKeyLong(data.asOf)}`}
					</div>
				</div>
				<div>
					<div className="eyebrow">People</div>
					<div className="mono mt-1 text-lg">{data.rows.length}</div>
					<div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
						<span>{counts.behind} behind</span>
						<span>{counts.slightly_behind} slightly</span>
						<span>{counts.on_track} on track</span>
					</div>
				</div>
			</div>

			<ReportTable
				columned
				headers={[
					{ label: "Person", sortKey: "name" },
					{ label: "Work", sortKey: "work", numeric: true },
					{ label: "Time-off", sortKey: "timeOff", numeric: true },
					{ label: "Total", sortKey: "total", numeric: true },
					{ label: "Target so far", sortKey: "target", numeric: true },
					{ label: "Δ", sortKey: "delta", numeric: true },
					{ label: "Status", sortKey: "status" },
				]}
				sort={sort}
				onSort={onSort}
				rows={rows.map((r) => {
					const label = r.status ? STATUS_LABEL[r.status] : null;
					return {
						key: r.userId,
						className: label?.row,
						cells: [
							<PersonCell key="person" userId={r.userId} name={r.name} />,
							formatReportHours(r.workSeconds),
							r.timeOffSeconds > 0 ? formatReportHours(r.timeOffSeconds) : "—",
							formatReportHours(r.totalSeconds),
							r.targetSeconds == null
								? "—"
								: formatReportHours(r.targetSeconds),
							r.deltaSeconds == null ? (
								"—"
							) : (
								<Delta key="delta" seconds={r.deltaSeconds} />
							),
							label ? (
								<StatusPill key="status" tone={label.tone}>
									{data.complete ? label.done : label.live}
								</StatusPill>
							) : (
								<span key="status" className="text-xs text-muted-foreground">
									No target
								</span>
							),
						],
						searchFields: [r.name, r.memberType],
					};
				})}
				empty="Nobody to track this month."
			/>

			<p className="max-w-[72ch] text-sm text-muted-foreground">
				<span className="font-medium text-foreground">
					How it's calculated.
				</span>{" "}
				The fund for the month comes from{" "}
				<MenuPath steps={["Settings", "Hour fund"]} /> — the official monthly
				figure, working days × 8h. Target so far = fund × working days before
				today ÷ working days in the month, where a working day is Monday to
				Friday and not a public holiday, so every working day is worth 8h. Today
				itself is not counted until it has passed, but a finished month counts
				every one of its working days. A person's total is work plus time-off,
				up to and including today. On track when the total reaches the target;
				slightly behind when it is within {data.tolerancePct}% of it (
				<MenuPath steps={["Settings", "Organization"]} />
				); behind otherwise. Hourly people are listed with their hours and no
				target unless an expected-hours figure was set for them.
			</p>
		</div>
	);
}
