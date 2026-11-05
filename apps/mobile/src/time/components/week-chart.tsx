import { Pressable, View } from "react-native";

import { dayOfMonth, weekdayShort } from "../../lib/days";
import { formatHours } from "../../lib/duration";
import { Text } from "../../ui/components";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import type { DayMark } from "../day-marks";

export type ChartDay = {
	date: string;
	seconds: number;
	holiday: string | null;
	/** Null for a day that is not judged. The server sends a string. */
	mark: DayMark | string | null;
};

const PLOT_HEIGHT = 88;

/**
 * The week as seven columns, as the home page of the web app draws it: a
 * column for each day, a dashed line at a day's worth, and the colour of
 * each day's mark. A column is a button that picks its day.
 */
export function WeekChart({
	days,
	daySeconds,
	selected,
	today,
	onSelect,
}: {
	days: ChartDay[];
	/** A day's worth, or null for a person with no target. */
	daySeconds: number | null;
	selected: string;
	today: string;
	onSelect: (day: string) => void;
}) {
	const palette = usePalette();
	const most = Math.max(
		daySeconds ?? 0,
		...days.map((day) => day.seconds),
		3600,
	);
	const targetTop =
		daySeconds == null
			? null
			: PLOT_HEIGHT - Math.round((daySeconds / most) * PLOT_HEIGHT);
	return (
		<View>
			{targetTop == null ? null : (
				<View
					accessible={false}
					importantForAccessibility="no-hide-descendants"
					style={{
						position: "absolute",
						left: 0,
						right: 0,
						top: targetTop,
						borderTopWidth: 1,
						borderStyle: "dashed",
						borderColor: palette.outline,
					}}
				/>
			)}
			<View style={{ flexDirection: "row", gap: SPACE.xs }}>
				{days.map((day) => {
					const isSelected = day.date === selected;
					const height =
						day.seconds > 0
							? Math.max(4, Math.round((day.seconds / most) * PLOT_HEIGHT))
							: 2;
					const color = day.holiday
						? palette.tertiary
						: day.mark === "done"
							? palette.primary
							: day.mark === "short"
								? palette.error
								: palette.outlineVariant;
					const markWords =
						day.mark === "done"
							? "done"
							: day.mark === "short"
								? "short"
								: day.mark === "covered"
									? "covered by the rest of the week"
									: null;
					return (
						<Pressable
							key={day.date}
							accessibilityRole="button"
							accessibilityState={{ selected: isSelected }}
							accessibilityLabel={[
								`${weekdayShort(day.date)} ${dayOfMonth(day.date)}`,
								`${formatHours(day.seconds)} logged`,
								day.holiday,
								markWords,
							]
								.filter((part) => part)
								.join(", ")}
							onPress={() => onSelect(day.date)}
							style={{
								flex: 1,
								alignItems: "center",
								borderRadius: 12,
								paddingBottom: SPACE.xs,
								backgroundColor: isSelected
									? palette.secondaryContainer
									: undefined,
							}}
						>
							<View
								style={{
									height: PLOT_HEIGHT,
									justifyContent: "flex-end",
									alignItems: "center",
									alignSelf: "stretch",
									borderBottomWidth: 1,
									borderColor: palette.outlineVariant,
								}}
							>
								<View
									style={{
										width: 18,
										height,
										borderTopLeftRadius: 3,
										borderTopRightRadius: 3,
										backgroundColor: color,
										opacity: day.mark === "covered" ? 0.6 : 1,
									}}
								/>
							</View>
							<Text
								variant="labelMedium"
								color={
									day.date === today
										? palette.primary
										: palette.onSurfaceVariant
								}
							>
								{weekdayShort(day.date)}
							</Text>
							<Text variant="bodySmall" color={palette.onSurfaceVariant}>
								{day.holiday
									? "Holiday"
									: day.seconds > 0
										? formatHours(day.seconds)
										: " "}
							</Text>
						</Pressable>
					);
				})}
			</View>
		</View>
	);
}
