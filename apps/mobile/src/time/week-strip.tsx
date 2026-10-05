import { Pressable, View } from "react-native";

import { dayOfMonth, weekdayShort } from "../lib/days";
import { formatHours } from "../lib/duration";
import { Text } from "../ui/components";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";

export type WeekStripProps = {
	days: string[];
	selected: string;
	today: string;
	/** Seconds logged on each day of `days`. */
	totals: Map<string, number>;
	onSelect: (day: string) => void;
};

/** The week around the selected day, with what each day holds. */
export function WeekStrip({
	days,
	selected,
	today,
	totals,
	onSelect,
}: WeekStripProps) {
	const palette = usePalette();
	return (
		<View style={{ flexDirection: "row", gap: SPACE.xs }}>
			{days.map((day) => {
				const isSelected = day === selected;
				const seconds = totals.get(day) ?? 0;
				return (
					<Pressable
						key={day}
						accessibilityRole="button"
						accessibilityState={{ selected: isSelected }}
						accessibilityLabel={`${weekdayShort(day)} ${dayOfMonth(day)}, ${formatHours(seconds)} logged`}
						onPress={() => onSelect(day)}
						android_ripple={{
							color: palette.outlineVariant,
							borderless: false,
						}}
						style={{
							flex: 1,
							alignItems: "center",
							paddingVertical: SPACE.s,
							borderRadius: 16,
							gap: 2,
							backgroundColor: isSelected
								? palette.primary
								: palette.surfaceContainer,
						}}
					>
						<Text
							variant="labelMedium"
							color={isSelected ? palette.onPrimary : palette.onSurfaceVariant}
						>
							{weekdayShort(day)}
						</Text>
						<Text
							variant="titleMedium"
							color={
								isSelected
									? palette.onPrimary
									: day === today
										? palette.primary
										: palette.onSurface
							}
						>
							{dayOfMonth(day)}
						</Text>
						<Text
							variant="bodySmall"
							color={isSelected ? palette.onPrimary : palette.onSurfaceVariant}
						>
							{seconds > 0 ? formatHours(seconds) : " "}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}
