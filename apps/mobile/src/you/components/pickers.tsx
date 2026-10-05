import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useEffect, useRef, useState } from "react";
import { Platform, useColorScheme, View } from "react-native";

import type { IconName } from "../../ui/icons";
import { SettingsValue } from "../../ui/settings-list";
import type { RowTint } from "../../ui/settings-list";
import { SPACE } from "../../ui/type";
import {
	clockOfPickedTime,
	keyOfPickedDate,
	pickerDateOf,
	pickerTimeOf,
} from "../format";

// Rows of a settings list that hold a time or a day, with the system's own
// picker. On Android a press opens the Material dialog. On iOS a press
// opens the wheel or the calendar under the row, as the Calendar app does,
// and a second press closes it.

/** iOS sends a value for each step of the wheel. A change is saved only
 *  when the wheel stops for this long, or when the row closes. */
const SETTLE_MS = 700;

type RowProps = {
	title: string;
	subtitle?: string;
	icon?: IconName;
	tint?: RowTint;
	disabled?: boolean;
};

/**
 * One time of day as "HH:mm". `onChange` gets the time the person chose,
 * once, after the picker stops.
 */
export function TimeSetting({
	value,
	onChange,
	...row
}: RowProps & { value: string; onChange: (time: string) => void }) {
	const scheme = useColorScheme();
	const [open, setOpen] = useState(false);
	// The time on the wheel while the row is open. A closed row shows the
	// saved value.
	const [draft, setDraft] = useState(value);
	const shown = open ? draft : value;
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const latest = useRef({ open, draft, value, onChange });

	useEffect(() => {
		latest.current = { open, draft, value, onChange };
	});

	const commit = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		const { draft: next, value: saved, onChange: save } = latest.current;
		if (next !== saved) save(next);
	};
	// A wheel that is still turning when the screen closes is saved too.
	useEffect(
		() => () => {
			const {
				open: wasOpen,
				draft: next,
				value: saved,
				onChange: save,
			} = latest.current;
			if (wasOpen && next !== saved) save(next);
		},
		[],
	);

	const toggle = () => {
		if (open) {
			commit();
		} else {
			setDraft(value);
		}
		setOpen(!open);
	};

	if (Platform.OS === "android") {
		return (
			<>
				<SettingsValue
					{...row}
					value={value}
					onPress={row.disabled ? undefined : () => setOpen(true)}
				/>
				{open ? (
					<DateTimePicker
						mode="time"
						value={pickerTimeOf(value)}
						presentation="dialog"
						onValueChange={(_event, date) => {
							setOpen(false);
							const next = clockOfPickedTime(date);
							if (next !== value) onChange(next);
						}}
						onDismiss={() => setOpen(false)}
					/>
				) : null}
			</>
		);
	}

	return (
		<>
			<SettingsValue
				{...row}
				value={shown}
				onPress={row.disabled ? undefined : toggle}
			/>
			{open ? (
				<View style={{ paddingHorizontal: SPACE.l, alignItems: "center" }}>
					<DateTimePicker
						mode="time"
						display="spinner"
						value={pickerTimeOf(draft)}
						themeVariant={scheme === "dark" ? "dark" : "light"}
						style={{ width: "100%" }}
						onValueChange={(_event, date) => {
							setDraft(clockOfPickedTime(date));
							if (timer.current) clearTimeout(timer.current);
							timer.current = setTimeout(commit, SETTLE_MS);
						}}
					/>
				</View>
			) : null}
		</>
	);
}

/** One day as a `yyyy-MM-dd` key. */
export function DateSetting({
	value,
	onChange,
	format,
	minimum,
	...row
}: RowProps & {
	value: string;
	onChange: (day: string) => void;
	/** How the row shows the day. */
	format: (day: string) => string;
	/** The first day the picker offers. */
	minimum?: string;
}) {
	const scheme = useColorScheme();
	const [open, setOpen] = useState(false);
	const minimumDate = minimum ? pickerDateOf(minimum) : undefined;

	if (Platform.OS === "android") {
		return (
			<>
				<SettingsValue
					{...row}
					value={format(value)}
					onPress={row.disabled ? undefined : () => setOpen(true)}
				/>
				{open ? (
					<DateTimePicker
						mode="date"
						value={pickerDateOf(value)}
						minimumDate={minimumDate}
						presentation="dialog"
						onValueChange={(_event, date) => {
							setOpen(false);
							onChange(keyOfPickedDate(date, "android"));
						}}
						onDismiss={() => setOpen(false)}
					/>
				) : null}
			</>
		);
	}

	return (
		<>
			<SettingsValue
				{...row}
				value={format(value)}
				onPress={row.disabled ? undefined : () => setOpen(!open)}
			/>
			{open ? (
				<View style={{ paddingHorizontal: SPACE.s }}>
					<DateTimePicker
						mode="date"
						display="inline"
						value={pickerDateOf(value)}
						minimumDate={minimumDate}
						themeVariant={scheme === "dark" ? "dark" : "light"}
						style={{ width: "100%" }}
						onValueChange={(_event, date) => {
							onChange(keyOfPickedDate(date, "ios"));
							setOpen(false);
						}}
					/>
				</View>
			) : null}
		</>
	);
}
