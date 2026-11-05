import { formatReportHours } from "@farmer/core/lib/report-format";
import type { PeriodTarget } from "@farmer/core/services";

import { StatusPill } from "#/components/status-pill.tsx";
import {
	TARGET_STATUS,
	TARGET_TONE,
	TargetGap,
} from "#/components/targets.tsx";
import { Of, StatTile, StatTiles } from "#/components/ui/stat-tile.tsx";

function TodayTile({
	daySeconds,
	todayTotal,
	entryCount,
}: {
	daySeconds: number;
	todayTotal: number;
	entryCount: number;
}) {
	return (
		<StatTile
			label="Today"
			percent={daySeconds > 0 ? (todayTotal / daySeconds) * 100 : null}
			tone={todayTotal >= daySeconds ? "ok" : "neutral"}
			value={
				<>
					{formatReportHours(todayTotal)}
					{daySeconds > 0 && <Of>/ {formatReportHours(daySeconds)}</Of>}
				</>
			}
			caption={
				daySeconds > todayTotal
					? `${formatReportHours(daySeconds - todayTotal)} to go`
					: `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`
			}
		/>
	);
}

function WeekTile({
	week,
	weekTotal,
}: {
	week: PeriodTarget;
	weekTotal: number;
}) {
	const weekStatus = week.status;
	return (
		<StatTile
			label="This week"
			aside={
				weekStatus && (
					<StatusPill tone={TARGET_STATUS[weekStatus].tone}>
						{TARGET_STATUS[weekStatus].label}
					</StatusPill>
				)
			}
			percent={
				week.targetSeconds ? (weekTotal / week.targetSeconds) * 100 : null
			}
			tone={weekStatus ? TARGET_TONE[weekStatus] : "neutral"}
			value={
				<>
					{formatReportHours(weekTotal)}
					{week.targetSeconds != null && (
						<Of>/ {formatReportHours(week.targetSeconds)}</Of>
					)}
				</>
			}
			caption={<TargetGap period={week} />}
		/>
	);
}

function MonthTile({ month }: { month: PeriodTarget }) {
	const monthStatus = month.status;
	return (
		<StatTile
			label="This month"
			aside={
				monthStatus && (
					<StatusPill tone={TARGET_STATUS[monthStatus].tone}>
						{TARGET_STATUS[monthStatus].label}
					</StatusPill>
				)
			}
			percent={
				month.targetSeconds
					? (month.totalSeconds / month.targetSeconds) * 100
					: null
			}
			tone={monthStatus ? TARGET_TONE[monthStatus] : "neutral"}
			value={
				<>
					{formatReportHours(month.totalSeconds)}
					{month.targetSeconds != null && (
						<Of>/ {formatReportHours(month.targetSeconds)}</Of>
					)}
				</>
			}
			caption={
				<>
					<TargetGap period={month} /> · {month.workingDaysElapsed} of{" "}
					{month.workingDays} working days done
				</>
			}
		/>
	);
}

/** Today, the week and the month, in that order: the horizon widens left
 *  to right, the full width of the page. */
export function OrgHomeStatBand({
	daySeconds,
	week,
	month,
	todayTotal,
	todayEntryCount,
	weekTotal,
}: {
	daySeconds: number;
	week: PeriodTarget;
	month: PeriodTarget;
	todayTotal: number;
	todayEntryCount: number;
	weekTotal: number;
}) {
	return (
		<StatTiles columns={3}>
			<TodayTile
				daySeconds={daySeconds}
				todayTotal={todayTotal}
				entryCount={todayEntryCount}
			/>
			<WeekTile week={week} weekTotal={weekTotal} />
			<MonthTile month={month} />
		</StatTiles>
	);
}
