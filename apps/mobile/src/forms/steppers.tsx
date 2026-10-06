import { View } from "react-native";

import { addDays, dayTitle } from "../lib/days";
import { formatHours, stepQuarter } from "../lib/duration";
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
}: {
	value: string;
	lessLabel: string;
	moreLabel: string;
	onLess: () => void;
	onMore: () => void;
	disabled?: boolean;
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
				disabled={disabled}
			/>
			<View style={{ flex: 1, alignItems: "center" }}>
				<Text variant="headlineSmall">{value}</Text>
			</View>
			<IconButton
				icon="add"
				label={moreLabel}
				tone="tonal"
				onPress={onMore}
				disabled={disabled}
			/>
		</View>
	);
}

/** A duration in 15-minute steps, between one step and 24 hours. */
export function DurationStepper({
	seconds,
	onChange,
	disabled,
}: {
	seconds: number;
	onChange: (seconds: number) => void;
	disabled?: boolean;
}) {
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
}: {
	day: string;
	today: string;
	onChange: (day: string) => void;
	disabled?: boolean;
}) {
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
