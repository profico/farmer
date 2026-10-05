import type { Period } from "@farmer/api-client";
import { View } from "react-native";

import { useTracking } from "../../api/queries";
import { formatHours } from "../../lib/duration";
import { Card, Skeleton, Text } from "../../ui/components";
import { ProgressBar } from "../../ui/progress";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import { targetGap, targetProgress, targetStatus } from "../targets";

function Target({ title, period }: { title: string; period: Period }) {
	const palette = usePalette();
	const status = targetStatus(period.status);
	const gap = targetGap(period);
	const progress = targetProgress(period);
	const toneColor =
		status?.tone === "good"
			? palette.primary
			: status?.tone === "warning"
				? palette.tertiary
				: status?.tone === "bad"
					? palette.error
					: palette.onSurfaceVariant;
	const figure =
		period.targetSeconds == null
			? formatHours(period.totalSeconds)
			: `${formatHours(period.totalSeconds)} / ${formatHours(period.targetSeconds)}`;
	return (
		<Card style={{ flex: 1, padding: SPACE.m, gap: SPACE.xs }}>
			<View
				accessible
				accessibilityLabel={[
					title,
					period.targetSeconds == null
						? `${formatHours(period.totalSeconds)} logged, no target`
						: `${formatHours(period.totalSeconds)} of ${formatHours(period.targetSeconds)}`,
					status?.label,
					gap?.text,
				]
					.filter((part) => part)
					.join(", ")}
				style={{ gap: SPACE.xs }}
			>
				<Text variant="labelMedium" color={palette.onSurfaceVariant}>
					{title}
				</Text>
				<Text variant="titleMedium" numberOfLines={1}>
					{figure}
				</Text>
				{progress != null ? <ProgressBar value={progress} /> : null}
				<Text variant="bodySmall" color={toneColor} numberOfLines={1}>
					{status?.label ?? "No target"}
				</Text>
				{gap ? (
					<Text
						variant="bodySmall"
						color={palette.onSurfaceVariant}
						numberOfLines={2}
					>
						{gap.text}
					</Text>
				) : null}
			</View>
		</Card>
	);
}

/**
 * This week and this month against the Tracking rule: the figure the
 * person fills the timesheet towards. It never holds the screen back: while
 * it loads it is a grey block, and a failed read hides it.
 */
export function TargetsStrip() {
	const tracking = useTracking();
	if (tracking.isPending) {
		return (
			<View style={{ flexDirection: "row", gap: SPACE.s }}>
				<View style={{ flex: 1 }}>
					<Skeleton height={108} />
				</View>
				<View style={{ flex: 1 }}>
					<Skeleton height={108} />
				</View>
			</View>
		);
	}
	if (tracking.isError) return null;
	return (
		<View style={{ flexDirection: "row", gap: SPACE.s }}>
			<Target title="This week" period={tracking.data.week} />
			<Target title="This month" period={tracking.data.month} />
		</View>
	);
}
