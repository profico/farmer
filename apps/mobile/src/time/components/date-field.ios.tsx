import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { View } from "react-native";

import { GroupIfAlone } from "../../forms/form-group";
import { FormRow } from "../../forms/form-row";
import { Text } from "../../ui/components";
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
	disabled,
}: DateFieldProps) {
	return (
		<GroupIfAlone>
			<FormRow grouped={false}>
				<View style={{ flex: 1 }}>
					<Text variant="bodyLarge">{label}</Text>
				</View>
				<View
					pointerEvents={disabled ? "none" : "auto"}
					style={{ opacity: disabled ? 0.4 : 1 }}
				>
					<DateTimePicker
						style={{ width: DATE_JUMP_WIDTH }}
						value={pickerValue(value)}
						mode="date"
						display="compact"
						timeZoneName={UTC}
						minimumDate={minimum ? pickerValue(minimum) : undefined}
						maximumDate={maximum ? pickerValue(maximum) : undefined}
						onValueChange={(_event, date) => onChange(pickedDay(date))}
					/>
				</View>
			</FormRow>
		</GroupIfAlone>
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
