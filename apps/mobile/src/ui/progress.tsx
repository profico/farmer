import { View } from "react-native";

import { usePalette } from "./theme";

export type ProgressBarProps = {
	/** 0 to 1. Above 1 is drawn full. */
	value: number;
};

/** A plain bar. Android and iOS draw the system's own control instead. */
export function ProgressBar({ value }: ProgressBarProps) {
	const palette = usePalette();
	return (
		<View
			style={{
				height: 4,
				borderRadius: 2,
				backgroundColor: palette.secondaryContainer,
				overflow: "hidden",
			}}
		>
			<View
				style={{
					width: `${Math.min(1, Math.max(0, value)) * 100}%`,
					height: 4,
					backgroundColor: palette.primary,
				}}
			/>
		</View>
	);
}
