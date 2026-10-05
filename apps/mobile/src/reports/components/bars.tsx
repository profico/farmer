import { View } from "react-native";

import { Card, Text } from "../../ui/components";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import { formatReportHours } from "../format";
import type { Bucket } from "../views";

/**
 * A thin bar that shows a share of the largest value in a list: the bar
 * beside the hours of each row, as on the web. One series, so it has no
 * legend; the row's text names it. The bar is hidden from a screen reader,
 * because the row reads out the number.
 */
export function ShareBar({ value, max }: { value: number; max: number }) {
	const palette = usePalette();
	const share = max > 0 ? Math.max(value / max, 0.02) : 0;
	return (
		<View
			accessible={false}
			importantForAccessibility="no-hide-descendants"
			accessibilityElementsHidden
			style={{
				height: 6,
				borderRadius: 3,
				backgroundColor: palette.secondaryContainer,
				overflow: "hidden",
			}}
		>
			<View
				style={{
					width: `${Math.min(share, 1) * 100}%`,
					height: 6,
					borderRadius: 3,
					backgroundColor: palette.primary,
				}}
			/>
		</View>
	);
}

const PLOT_HEIGHT = 120;

/**
 * The hours of a period as columns: one for each day of a short range,
 * one for each month of a long one. Columns with a 2 dp gap, rounded at
 * the data end and on one baseline. Only the highest column has a label;
 * the axis marks the first and the last bucket. A screen reader reads the
 * chart as one sentence with the highest bucket, and the list under the
 * chart holds every figure.
 */
export function ColumnChart({
	title,
	buckets,
}: {
	title: string;
	buckets: Bucket[];
}) {
	const palette = usePalette();
	if (buckets.length === 0) return null;
	const max = Math.max(...buckets.map((bucket) => bucket.seconds), 0);
	const top = buckets.reduce(
		(best, bucket) => (bucket.seconds > best.seconds ? bucket : best),
		buckets[0] ?? { key: "", label: "", seconds: 0 },
	);
	const first = buckets[0];
	const last = buckets[buckets.length - 1];
	const summary =
		max > 0
			? `${title}. The most hours, ${formatReportHours(top.seconds)}, on ${top.label}.`
			: `${title}. No hours.`;
	return (
		<Card>
			<Text variant="titleSmall">{title}</Text>
			<View
				accessible
				accessibilityRole="image"
				accessibilityLabel={summary}
				style={{ gap: SPACE.xs }}
			>
				<Text variant="labelMedium" color={palette.onSurfaceVariant}>
					{max > 0 ? `Highest ${formatReportHours(max)} h` : "No hours"}
				</Text>
				<View
					style={{
						height: PLOT_HEIGHT,
						flexDirection: "row",
						alignItems: "flex-end",
						gap: 2,
						borderBottomWidth: 1,
						borderBottomColor: palette.outlineVariant,
					}}
				>
					{buckets.map((bucket) => (
						<View
							key={bucket.key}
							style={{
								flex: 1,
								height:
									bucket.seconds > 0
										? Math.max(2, (bucket.seconds / max) * PLOT_HEIGHT)
										: 0,
								borderTopLeftRadius: 4,
								borderTopRightRadius: 4,
								backgroundColor:
									bucket.key === top.key && max > 0
										? palette.primary
										: palette.secondaryContainer,
							}}
						/>
					))}
				</View>
				<View style={{ flexDirection: "row", justifyContent: "space-between" }}>
					<Text variant="labelMedium" color={palette.onSurfaceVariant}>
						{first?.label ?? ""}
					</Text>
					<Text variant="labelMedium" color={palette.onSurfaceVariant}>
						{last && last !== first ? last.label : ""}
					</Text>
				</View>
			</View>
		</Card>
	);
}
