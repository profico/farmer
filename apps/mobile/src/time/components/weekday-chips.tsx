import { Pressable, View } from "react-native";

import { Text } from "../../ui/components";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import { orderedWeekdays, weekdayName } from "../calendar";

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
						style={{
							flex: 1,
							height: 40,
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
