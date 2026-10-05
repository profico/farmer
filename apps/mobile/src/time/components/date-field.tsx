import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { IconButton, Text } from "../../ui/components";
import { Icon } from "../../ui/icon";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import { pickedDay, pickerValue } from "../calendar";

export type DateFieldProps = {
	label: string;
	/** A day key. */
	value: string;
	onChange: (day: string) => void;
	minimum?: string;
	maximum?: string;
};

const longDay = (day: string) =>
	new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(pickerValue(day));

/** The Material 3 date picker dialog, open while it is mounted. */
function PickerDialog({
	value,
	minimum,
	maximum,
	onPick,
	onClose,
}: {
	value: string;
	minimum?: string;
	maximum?: string;
	onPick: (day: string) => void;
	onClose: () => void;
}) {
	return (
		<DateTimePicker
			value={pickerValue(value)}
			mode="date"
			presentation="dialog"
			minimumDate={minimum ? pickerValue(minimum) : undefined}
			maximumDate={maximum ? pickerValue(maximum) : undefined}
			onValueChange={(_event, date) => {
				onClose();
				onPick(pickedDay(date));
			}}
			onDismiss={onClose}
		/>
	);
}

/**
 * A day in a form. Android shows the day as a row that opens the Material
 * date picker; iOS draws the compact SwiftUI picker
 * (`date-field.ios.tsx`).
 */
export function DateField({
	label,
	value,
	onChange,
	minimum,
	maximum,
}: DateFieldProps) {
	const palette = usePalette();
	const [open, setOpen] = useState(false);
	return (
		<View style={{ gap: SPACE.xs }}>
			<Text variant="labelMedium" color={palette.onSurfaceVariant}>
				{label}
			</Text>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${label}: ${longDay(value)}`}
				accessibilityHint="Opens the date picker"
				onPress={() => setOpen(true)}
				android_ripple={{ color: palette.outlineVariant }}
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: SPACE.m,
					borderWidth: 1,
					borderColor: palette.outline,
					borderRadius: Platform.OS === "ios" ? 10 : 4,
					paddingHorizontal: SPACE.l,
					minHeight: 52,
				}}
			>
				<Icon name="calendar" size={20} color={palette.onSurfaceVariant} />
				<View style={{ flex: 1 }}>
					<Text variant="bodyLarge">{longDay(value)}</Text>
				</View>
			</Pressable>
			{open ? (
				<PickerDialog
					value={value}
					minimum={minimum}
					maximum={maximum}
					onPick={onChange}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</View>
	);
}

/** A button that jumps to a day, for a title row. */
export function DateJump({
	value,
	onPick,
	label = "Jump to a date",
}: {
	value: string;
	onPick: (day: string) => void;
	label?: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<IconButton icon="calendar" label={label} onPress={() => setOpen(true)} />
			{open ? (
				<PickerDialog
					value={value}
					onPick={onPick}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</>
	);
}
