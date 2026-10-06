import { Host, Stepper } from "@expo/ui/swift-ui";
import {
	disabled as disabledModifier,
	labelsHidden,
} from "@expo/ui/swift-ui/modifiers";

import {
	formatHours,
	MAX_DAY_SECONDS,
	QUARTER_HOUR_SECONDS,
} from "../lib/duration";
import { DateField } from "../time/components/date-field";
import { HEAD_START_STEP_SECONDS, lastHeadStart } from "../time/head-start";
import { Text } from "../ui/components";
import { useHostTheme } from "../ui/host";
import { usePalette } from "../ui/theme";
import { GroupIfAlone } from "./form-group";
import { FormRow } from "./form-row";
import type {
	DayStepperProps,
	DurationStepperProps,
	HeadStartStepperProps,
} from "./steppers";

/** One row: the label and the value at the start, the system stepper at
 *  the end. The system control keeps the step, the least and the most. */
function StepperRow({
	label,
	display,
	value,
	min,
	max,
	step,
	onChange,
	disabled,
}: {
	label: string;
	display: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
	disabled?: boolean;
}) {
	const palette = usePalette();
	const hostTheme = useHostTheme();
	return (
		<GroupIfAlone>
			<FormRow grouped={false}>
				<Text variant="bodyLarge" numberOfLines={1}>
					{label}
				</Text>
				<Text variant="bodyLarge" color={palette.onSurfaceVariant} numeric>
					{display}
				</Text>
				<Host matchContents style={{ marginLeft: "auto" }} {...hostTheme}>
					<Stepper
						label={`${label}, ${display}`}
						value={value}
						min={min}
						max={max}
						step={step}
						onValueChange={onChange}
						modifiers={
							disabled
								? [labelsHidden(), disabledModifier(true)]
								: [labelsHidden()]
						}
					/>
				</Host>
			</FormRow>
		</GroupIfAlone>
	);
}

/** A duration in 15-minute steps, between one step and 24 hours. */
export function DurationStepper({
	seconds,
	onChange,
	disabled,
	label = "Time",
}: DurationStepperProps) {
	return (
		<StepperRow
			label={label}
			display={formatHours(seconds)}
			value={seconds}
			min={QUARTER_HOUR_SECONDS}
			max={MAX_DAY_SECONDS}
			step={QUARTER_HOUR_SECONDS}
			onChange={onChange}
			disabled={disabled}
		/>
	);
}

/** A day, as a row with the compact date picker of the system. */
export function DayStepper({
	day,
	onChange,
	disabled,
	label = "Day",
}: DayStepperProps) {
	return (
		<DateField
			label={label}
			value={day}
			onChange={onChange}
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
	label = "Timer starts from",
}: HeadStartStepperProps) {
	return (
		<StepperRow
			label={label}
			display={formatHours(seconds)}
			value={seconds}
			min={0}
			max={lastHeadStart(limit)}
			step={HEAD_START_STEP_SECONDS}
			onChange={onChange}
		/>
	);
}
