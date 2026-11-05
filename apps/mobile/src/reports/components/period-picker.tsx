import DateTimePicker from "@expo/ui/community/datetime-picker";
import { useState } from "react";
import { Platform, View } from "react-native";

import { addDays } from "../../lib/days";
import {
	datePickerBound,
	datePickerResult,
	datePickerValue,
} from "../../time/calendar";
import { ActionButton, IconButton, Text } from "../../ui/components";
import { SegmentedControl } from "../../ui/segmented";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import {
	choosePreset,
	dayLabel,
	isCurrentPeriod,
	MAX_REPORT_SPAN_DAYS,
	PERIOD_PRESETS,
	type PeriodSelection,
	periodLabel,
	resolvePeriod,
	returnLabel,
	stepPeriod,
} from "../period";

/** One end of a custom range: the system date picker. iOS shows the
 *  compact button; Android opens the Material dialog from a button. */
function DayField({
	label,
	value,
	min,
	max,
	onChange,
}: {
	label: string;
	value: string;
	min: string;
	max: string;
	onChange: (key: string) => void;
}) {
	const palette = usePalette();
	const [open, setOpen] = useState(false);
	const platform = Platform.OS === "android" ? "android" : "ios";
	const picker = (
		<DateTimePicker
			value={datePickerValue(value, platform)}
			mode="date"
			display={platform === "ios" ? "compact" : "default"}
			minimumDate={datePickerBound(min)}
			maximumDate={datePickerBound(max)}
			onChange={(event, date) => {
				setOpen(false);
				if (event.type === "set" && date)
					onChange(datePickerResult(date, platform));
			}}
		/>
	);
	return (
		<View style={{ gap: SPACE.xs, flex: 1 }}>
			<Text variant="labelMedium" color={palette.onSurfaceVariant}>
				{label}
			</Text>
			{Platform.OS === "ios" ? (
				picker
			) : (
				<>
					<ActionButton
						label={dayLabel(value)}
						variant="outlined"
						onPress={() => setOpen(true)}
					/>
					{open ? picker : null}
				</>
			)}
		</View>
	);
}

/**
 * The period of a report, as one control, like the web's: the preset
 * (Week, Month, Quarter, Year, Custom), then the period with a step back
 * and a step on. A custom range has no next period, so it has two date
 * fields instead of the steps.
 */
export function PeriodPicker({
	selection,
	onChange,
	today,
	weekStartsOn,
}: {
	selection: PeriodSelection;
	onChange: (selection: PeriodSelection) => void;
	today: string;
	weekStartsOn: number;
}) {
	const palette = usePalette();
	const { preset, from, to } = resolvePeriod(selection, today, weekStartsOn);
	const label = periodLabel(selection, today, weekStartsOn);
	const atNow = isCurrentPeriod(selection, today, weekStartsOn);
	const step = (delta: number) =>
		onChange(stepPeriod(selection, delta, today, weekStartsOn));

	return (
		<View style={{ gap: SPACE.s }}>
			<SegmentedControl
				options={PERIOD_PRESETS}
				value={preset}
				onChange={(next) =>
					onChange(choosePreset(selection, next, today, weekStartsOn))
				}
			/>
			{preset === "custom" ? (
				<View style={{ flexDirection: "row", gap: SPACE.m }}>
					<DayField
						label="From"
						value={from}
						min={addDays(to, -MAX_REPORT_SPAN_DAYS)}
						max={to}
						onChange={(key) => onChange({ ...selection, from: key })}
					/>
					<DayField
						label="To"
						value={to}
						min={from}
						max={addDays(from, MAX_REPORT_SPAN_DAYS)}
						onChange={(key) => onChange({ ...selection, to: key })}
					/>
				</View>
			) : (
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}
				>
					<IconButton
						icon="back"
						label="Previous period"
						onPress={() => step(-1)}
					/>
					<View style={{ flex: 1, alignItems: "center" }}>
						<Text variant="titleMedium" align="center">
							{label}
						</Text>
					</View>
					<IconButton
						icon="forward"
						label="Next period"
						onPress={() => step(1)}
					/>
				</View>
			)}
			{!atNow && preset !== "custom" ? (
				<View style={{ alignItems: "center" }}>
					<ActionButton
						label={returnLabel(preset)}
						variant="text"
						onPress={() =>
							onChange({
								...selection,
								month: undefined,
								from: undefined,
								to: undefined,
							})
						}
					/>
				</View>
			) : null}
			{preset === "custom" ? (
				<Text
					variant="bodySmall"
					color={palette.onSurfaceVariant}
					align="center"
				>
					{`At most ${MAX_REPORT_SPAN_DAYS} days.`}
				</Text>
			) : null}
		</View>
	);
}
