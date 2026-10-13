import { Pressable, View } from "react-native";

import { Text } from "./components";
import { usePalette } from "./theme";
import { MIN_TARGET } from "./touch-target";
import { SPACE } from "./type";

export type SegmentOption<T extends string> = { value: T; label: string };

export type SegmentedControlProps<T extends string> = {
	options: SegmentOption<T>[];
	value: T;
	onChange: (value: T) => void;
};

/**
 * A choice of one view among a few. iOS draws the system segmented picker
 * (`segmented.ios.tsx`) and Android the Material 3 segmented buttons
 * (`segmented.android.tsx`); this one is the fallback.
 */
export function SegmentedControl<T extends string>({
	options,
	value,
	onChange,
}: SegmentedControlProps<T>) {
	const palette = usePalette();
	return (
		<View
			accessibilityRole="tablist"
			style={{
				flexDirection: "row",
				borderRadius: 20,
				borderWidth: 1,
				borderColor: palette.outline,
				overflow: "hidden",
			}}
		>
			{options.map((option) => {
				const selected = option.value === value;
				return (
					<Pressable
						key={option.value}
						accessibilityRole="tab"
						accessibilityState={{ selected }}
						onPress={() => onChange(option.value)}
						style={{
							flex: 1,
							alignItems: "center",
							minHeight: MIN_TARGET,
							justifyContent: "center",
							paddingVertical: SPACE.s,
							backgroundColor: selected
								? palette.secondaryContainer
								: undefined,
						}}
					>
						<Text variant="labelLarge" numberOfLines={1}>
							{option.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}
