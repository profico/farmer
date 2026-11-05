import {
	Host,
	LinearProgressIndicator,
	LinearWavyProgressIndicator,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";

import { useHostTheme } from "./host";
import { useMotionPreference } from "./motion";
import type { ProgressBarProps } from "./progress";
import { usePalette } from "./theme";

/**
 * The Material 3 Expressive wavy progress bar, with the stop indicator at
 * the end of the track. With less motion the bar is flat, because a wave
 * that moves is motion.
 */
export function ProgressBar({ value }: ProgressBarProps) {
	const hostTheme = useHostTheme();
	const palette = usePalette();
	const { reduceMotion } = useMotionPreference();
	const progress = Math.min(1, Math.max(0, value));
	return (
		<Host
			matchContents={{ vertical: true }}
			style={{ alignSelf: "stretch" }}
			{...hostTheme}
		>
			{reduceMotion ? (
				<LinearProgressIndicator
					progress={progress}
					color={palette.primary}
					trackColor={palette.secondaryContainer}
					drawStopIndicator={{ color: palette.primary }}
					modifiers={[fillMaxWidth()]}
				/>
			) : (
				<LinearWavyProgressIndicator
					progress={progress}
					color={palette.primary}
					trackColor={palette.secondaryContainer}
					modifiers={[fillMaxWidth()]}
				/>
			)}
		</Host>
	);
}
