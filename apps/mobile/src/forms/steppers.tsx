import { View } from "react-native";

import { addDays, dayTitle } from "../lib/days";
import { formatHours, stepQuarter } from "../lib/duration";
import { stepHeadStart } from "../time/head-start";
import { IconButton, Text } from "../ui/components";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";

function Stepper({
	value,
	lessLabel,
	moreLabel,
	onLess,
	onMore,
	disabled,
	lessDisabled,
	moreDisabled,
	valueLabel,
}: {
	value: string;
	lessLabel: string;
	moreLabel: string;
	onLess: () => void;
	onMore: () => void;
	disabled?: boolean;
	lessDisabled?: boolean;
	moreDisabled?: boolean;
	/** The words a screen reader reads for the value. */
	valueLabel?: string;
}) {
	const palette = usePalette();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.m,
				backgroundColor: palette.surfaceContainer,
				borderRadius: 16,
				padding: SPACE.s,
			}}
		>
			<IconButton
				icon="minus"
				label={lessLabel}
				tone="tonal"
				onPress={onLess}
				disabled={disabled || lessDisabled}
			/>
			<View
				style={{ flex: 1, alignItems: "center" }}
				accessible={valueLabel !== undefined}
				accessibilityLabel={valueLabel}
				accessibilityLiveRegion={valueLabel ? "polite" : undefined}
			>
				<Text variant="headlineSmall">{value}</Text>
			</View>
			<IconButton
				icon="add"
				label={moreLabel}
				tone="tonal"
				onPress={onMore}
				disabled={disabled || moreDisabled}
			/>
		</View>
	);
}

export type DurationStepperProps = {
	seconds: number;
	onChange: (seconds: number) => void;
	disabled?: boolean;
	/** The label of the row on iOS. Android has the label of the section. */
	label?: string;
};

export type DayStepperProps = {
	day: string;
	today: string;
	onChange: (day: string) => void;
	disabled?: boolean;
	/** The label of the row on iOS. Android has the label of the section. */
	label?: string;
};

export type HeadStartStepperProps = {
	seconds: number;
	onChange: (seconds: number) => void;
	/** The bound the head start must stay under. */
	limit: number;
	label?: string;
};

/** A duration in 15-minute steps, between one step and 24 hours. */
export function DurationStepper({
	seconds,
	onChange,
	disabled,
}: DurationStepperProps) {
	return (
		<Stepper
			value={formatHours(seconds)}
			lessLabel="15 minutes less"
			moreLabel="15 minutes more"
			onLess={() => onChange(stepQuarter(seconds, -1))}
			onMore={() => onChange(stepQuarter(seconds, 1))}
			disabled={disabled}
		/>
	);
}

/** A day, one day back or forward at a time. */
export function DayStepper({
	day,
	today,
	onChange,
	disabled,
}: DayStepperProps) {
	return (
		<Stepper
			value={dayTitle(day, today)}
			lessLabel="The day before"
			moreLabel="The day after"
			onLess={() => onChange(addDays(day, -1))}
			onMore={() => onChange(addDays(day, 1))}
			disabled={disabled}
		/>
	);
}

/** A head start in 5-minute steps, from zero to the last step under the
 *  limit. */
export function HeadStartStepper({
	seconds,
	onChange,
	limit,
}: HeadStartStepperProps) {
	return (
		<Stepper
			value={formatHours(seconds)}
			lessLabel="5 minutes less of a head start"
			moreLabel="5 minutes more of a head start"
			onLess={() => onChange(stepHeadStart(seconds, -1, limit))}
			onMore={() => onChange(stepHeadStart(seconds, 1, limit))}
			lessDisabled={seconds === 0}
			moreDisabled={stepHeadStart(seconds, 1, limit) === seconds}
			valueLabel={`Timer starts from ${formatHours(seconds)}`}
		/>
	);
}
