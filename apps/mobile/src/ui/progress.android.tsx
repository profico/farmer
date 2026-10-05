import { Host, LinearProgressIndicator } from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";

import type { ProgressBarProps } from "./progress";
import { usePalette } from "./theme";

export function ProgressBar({ value }: ProgressBarProps) {
	const palette = usePalette();
	return (
		<Host matchContents={{ vertical: true }} style={{ alignSelf: "stretch" }}>
			<LinearProgressIndicator
				progress={Math.min(1, Math.max(0, value))}
				color={palette.primary}
				trackColor={palette.secondaryContainer}
				modifiers={[fillMaxWidth()]}
			/>
		</Host>
	);
}
