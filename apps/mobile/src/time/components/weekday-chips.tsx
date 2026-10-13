import { Platform, Pressable, View } from "react-native";

import { Text } from "../../ui/components";
import { usePalette } from "../../ui/theme";
import { minTargetFor, verticalSlop } from "../../ui/touch-target";
import { SPACE } from "../../ui/type";
import { orderedWeekdays, weekdayName } from "../calendar";

const CHIP_HEIGHT = 40;

/** The chip is 40 high. The `hitSlop` grows the touch target to the minimum
 *  of the platform without a change of what the chip draws. Seven chips fill
 *  the width, so the slop is vertical only. */
const SLOP = verticalSlop(CHIP_HEIGHT, minTargetFor(Platform.OS));

/** The days of the week to repeat on, in the workspace's order. Each chip
 *  is a check box for a screen reader. */
export function WeekdayChips({
	value,
	weekStartsOn,
	onChange,
}: {
	value: number[];
	weekStartsOn: number;
	onChange: (days: number[]) => void;
}) {
	const palette = usePalette();
	return (
		<View style={{ flexDirection: "row", gap: SPACE.xs }}>
			{orderedWeekdays(weekStartsOn).map((day) => {
				const on = value.includes(day);
				const name = weekdayName(day);
				return (
					<Pressable
						key={day}
						accessibilityRole="checkbox"
						accessibilityState={{ checked: on }}
						accessibilityLabel={name}
						onPress={() =>
							onChange(
								on
									? value.filter((item) => item !== day)
									: [...value, day].sort((a, b) => a - b),
							)
						}
						hitSlop={SLOP}
						style={{
							flex: 1,
							height: CHIP_HEIGHT,
							borderRadius: 20,
							alignItems: "center",
							justifyContent: "center",
							borderWidth: 1,
							borderColor: on ? palette.primary : palette.outline,
							backgroundColor: on ? palette.primary : undefined,
						}}
					>
						<Text
							variant="labelMedium"
							color={on ? palette.onPrimary : palette.onSurfaceVariant}
						>
							{name.slice(0, 2)}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}
