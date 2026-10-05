import type { Period } from "@farmer/api-client";
import { View } from "react-native";

import { useEntries, useTracking, useWhoami } from "../../src/api/queries";
import { periodTitle, weekdayShort, weekOf } from "../../src/lib/days";
import { formatHours } from "../../src/lib/duration";
import { Card, ErrorState, Skeleton, Text } from "../../src/ui/components";
import type { Palette } from "../../src/ui/palette";
import { ProgressBar } from "../../src/ui/progress";
import { Inset, Screen } from "../../src/ui/screen";
import { usePalette } from "../../src/ui/theme";
import { SPACE } from "../../src/ui/type";

/** The verdict in words. One this app does not know yet is shown as the
 *  server names it. */
const statusName = (status: string) => {
	switch (status) {
		case "on_track":
			return "On track";
		case "slightly_behind":
			return "Slightly behind";
		case "behind":
			return "Behind";
		default:
			return status;
	}
};

const statusColor = (status: string | null, palette: Palette) =>
	status === "behind"
		? palette.error
		: status === "slightly_behind"
			? palette.tertiary
			: palette.primary;

function PeriodCard({ title, period }: { title: string; period: Period }) {
	const palette = usePalette();
	const target = period.targetSoFarSeconds;
	return (
		<Card>
			<View style={{ flexDirection: "row", alignItems: "baseline" }}>
				<View style={{ flex: 1 }}>
					<Text variant="titleMedium">{title}</Text>
					<Text variant="bodySmall" color={palette.onSurfaceVariant}>
						{periodTitle(period.from, period.to)}
					</Text>
				</View>
				{period.status ? (
					<Text
						variant="labelLarge"
						color={statusColor(period.status, palette)}
					>
						{statusName(period.status)}
					</Text>
				) : null}
			</View>
			<Text variant="headlineSmall">
				{formatHours(period.totalSoFarSeconds)}
				{target !== null ? (
					<Text variant="titleMedium" color={palette.onSurfaceVariant}>
						{` of ${formatHours(target)} so far`}
					</Text>
				) : null}
			</Text>
			{target ? (
				<ProgressBar value={period.totalSoFarSeconds / target} />
			) : null}
			<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
				{formatHours(period.workSeconds)} work,{" "}
				{formatHours(period.timeOffSeconds)} time off.{" "}
				{period.workingDaysElapsed} of {period.workingDays} working days gone.
				{period.targetSeconds !== null
					? ` The target for the whole period is ${formatHours(period.targetSeconds)}.`
					: ""}
			</Text>
		</Card>
	);
}

/** The bars of the current week, one for each day. */
function WeekBars({
	today,
	weekStartsOn,
}: {
	today: string;
	weekStartsOn: number;
}) {
	const palette = usePalette();
	const days = weekOf(today, weekStartsOn);
	const entries = useEntries(days[0] ?? today, days[6] ?? today);
	if (entries.isPending) return <Skeleton height={160} radius={16} />;
	if (entries.isError) return null;
	const totals = days.map((day) =>
		entries.data
			.filter((entry) => entry.date === day)
			.reduce((sum, entry) => sum + entry.durationSeconds, 0),
	);
	const highest = Math.max(8 * 3600, ...totals);
	return (
		<Card>
			<Text variant="titleMedium">This week, by day</Text>
			<View
				style={{
					flexDirection: "row",
					alignItems: "flex-end",
					height: 140,
					gap: SPACE.s,
					paddingTop: SPACE.s,
				}}
			>
				{days.map((day, index) => {
					const seconds = totals[index] ?? 0;
					return (
						<View
							key={day}
							accessibilityLabel={`${weekdayShort(day)}: ${formatHours(seconds)}`}
							style={{ flex: 1, alignItems: "center", gap: SPACE.xs }}
						>
							<Text variant="labelMedium" color={palette.onSurfaceVariant}>
								{seconds > 0 ? formatHours(seconds) : ""}
							</Text>
							<View
								style={{
									width: "70%",
									height: Math.max(4, (seconds / highest) * 96),
									borderRadius: 8,
									backgroundColor:
										day === today
											? palette.primary
											: palette.secondaryContainer,
								}}
							/>
							<Text
								variant="labelMedium"
								color={
									day === today ? palette.primary : palette.onSurfaceVariant
								}
							>
								{weekdayShort(day)}
							</Text>
						</View>
					);
				})}
			</View>
		</Card>
	);
}

/** The person's own week and month against the targets, as `farmer status`
 *  and the web app's home page read them. */
export default function ReportsScreen() {
	const tracking = useTracking();
	const whoami = useWhoami();

	return (
		<Screen
			title="Reports"
			refreshing={tracking.isRefetching}
			onRefresh={() => void tracking.refetch()}
		>
			<Inset>
				{tracking.isPending ? (
					<>
						<Skeleton height={140} radius={16} />
						<Skeleton height={140} radius={16} />
					</>
				) : tracking.isError ? (
					<ErrorState
						error={tracking.error}
						onRetry={() => void tracking.refetch()}
					/>
				) : (
					<>
						<PeriodCard title="This week" period={tracking.data.week} />
						<PeriodCard title="This month" period={tracking.data.month} />
					</>
				)}
				{whoami.data ? (
					<WeekBars
						today={whoami.data.today}
						weekStartsOn={whoami.data.weekStartsOn}
					/>
				) : null}
			</Inset>
		</Screen>
	);
}
