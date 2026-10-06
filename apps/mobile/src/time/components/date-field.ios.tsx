import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { View } from "react-native";

import { Text } from "../../ui/components";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import { pickedDay, pickerValue } from "../calendar";
import type { DateFieldProps } from "./date-field";

// The SwiftUI picker counts in UTC here, so the value at noon in UTC shows
// the day of the key wherever the phone is (see `calendar.ts`).
const UTC = "UTC";

/** The width of the compact date pill, in points. */
const DATE_JUMP_WIDTH = 132;

/** The compact SwiftUI date picker beside its label, as a row of a form. */
export function DateField({
	label,
	value,
	onChange,
	minimum,
	maximum,
}: DateFieldProps) {
	const palette = usePalette();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.m,
				minHeight: 44,
			}}
		>
			<View style={{ flex: 1 }}>
				<Text variant="bodyLarge" color={palette.onSurface}>
					{label}
				</Text>
			</View>
			<DateTimePicker
				value={pickerValue(value)}
				mode="date"
				display="compact"
				timeZoneName={UTC}
				minimumDate={minimum ? pickerValue(minimum) : undefined}
				maximumDate={maximum ? pickerValue(maximum) : undefined}
				onValueChange={(_event, date) => onChange(pickedDay(date))}
			/>
		</View>
	);
}

/** The compact picker of the day on screen, for a title row. Its popover
 *  is the iOS calendar. The picker has no width of its own in a row, so it
 *  takes a fixed one, wide enough for the longest date, and the title next
 *  to it gives way. */
export function DateJump({
	value,
	onPick,
}: {
	value: string;
	onPick: (day: string) => void;
	label?: string;
}) {
	return (
		<DateTimePicker
			style={{ width: DATE_JUMP_WIDTH }}
			value={pickerValue(value)}
			mode="date"
			display="compact"
			timeZoneName={UTC}
			onValueChange={(_event, date) => onPick(pickedDay(date))}
		/>
	);
}
