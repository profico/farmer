import { Platform, Pressable, View } from "react-native";

import { Text } from "../../ui/components";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import { orderedWeekdays, weekdayInitial, weekdayName } from "../format";

/**
 * The seven weekdays as round chips, from the first day of the workspace's
 * week. A chosen day is filled. Each chip is a checkbox with the full name
 * of its day, so a screen reader does not read a single letter.
 */
export function WeekdayChips({
	value,
	onChange,
	weekStartsOn,
	disabled,
}: {
	value: number[];
	onChange: (days: number[]) => void;
	weekStartsOn: number;
	disabled?: boolean;
}) {
	const palette = usePalette();
	const toggle = (day: number) =>
		onChange(
			value.includes(day)
				? value.filter((d) => d !== day)
				: [...value, day].sort((a, b) => a - b),
		);
	return (
		<View
			style={{
				flexDirection: "row",
				justifyContent: "space-between",
				gap: SPACE.xs,
			}}
		>
			{orderedWeekdays(weekStartsOn).map((day) => {
				const on = value.includes(day);
				return (
					<Pressable
						key={day}
						accessibilityRole="checkbox"
						accessibilityLabel={weekdayName(day)}
						accessibilityState={{ checked: on, disabled }}
						disabled={disabled}
						onPress={() => toggle(day)}
						android_ripple={{ color: palette.outlineVariant, borderless: true }}
						hitSlop={4}
						style={({ pressed }) => ({
							width: 40,
							height: 40,
							borderRadius: 20,
							alignItems: "center",
							justifyContent: "center",
							borderWidth: on ? 0 : 1,
							borderColor: palette.outline,
							backgroundColor: on ? palette.primary : "transparent",
							opacity: disabled
								? 0.38
								: Platform.OS === "ios" && pressed
									? 0.6
									: 1,
						})}
					>
						<Text
							variant="labelLarge"
							color={on ? palette.onPrimary : palette.onSurfaceVariant}
						>
							{weekdayInitial(day)}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

/** The seven weekdays as small dots with letters, read only: which days a
 *  recurring block covers. */
export function WeekdayDots({
	value,
	weekStartsOn,
	muted,
}: {
	value: number[];
	weekStartsOn: number;
	muted?: boolean;
}) {
	const palette = usePalette();
	return (
		<View
			style={{ flexDirection: "row", gap: 3 }}
			accessible={false}
			importantForAccessibility="no-hide-descendants"
			accessibilityElementsHidden
		>
			{orderedWeekdays(weekStartsOn).map((day) => {
				const on = value.includes(day);
				return (
					<View
						key={day}
						style={{
							width: 20,
							height: 20,
							borderRadius: 10,
							alignItems: "center",
							justifyContent: "center",
							backgroundColor: on
								? muted
									? palette.outline
									: palette.primary
								: palette.surfaceContainerHigh,
						}}
					>
						<Text
							variant="bodySmall"
							color={on ? palette.onPrimary : palette.onSurfaceVariant}
						>
							{weekdayInitial(day)}
						</Text>
					</View>
				);
			})}
		</View>
	);
}
