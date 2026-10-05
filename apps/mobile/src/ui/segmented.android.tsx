import {
	Host,
	SegmentedButton,
	SingleChoiceSegmentedButtonRow,
	Text,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";

import { useHostTheme } from "./host";
import type { SegmentedControlProps } from "./segmented";

export function SegmentedControl<T extends string>({
	options,
	value,
	onChange,
}: SegmentedControlProps<T>) {
	const hostTheme = useHostTheme();
	return (
		<Host
			matchContents={{ vertical: true }}
			style={{ alignSelf: "stretch" }}
			{...hostTheme}
		>
			<SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
				{options.map((option) => (
					<SegmentedButton
						key={option.value}
						selected={option.value === value}
						onClick={() => onChange(option.value)}
					>
						<SegmentedButton.Label>
							<Text>{option.label}</Text>
						</SegmentedButton.Label>
					</SegmentedButton>
				))}
			</SingleChoiceSegmentedButtonRow>
		</Host>
	);
}
