import { Host, ProgressView } from "@expo/ui/swift-ui";
import { tint } from "@expo/ui/swift-ui/modifiers";

import { useHostTheme } from "./host";
import type { ProgressBarProps } from "./progress";
import { usePalette } from "./theme";

export function ProgressBar({ value }: ProgressBarProps) {
	const hostTheme = useHostTheme();
	const palette = usePalette();
	return (
		<Host
			matchContents={{ vertical: true }}
			style={{ alignSelf: "stretch" }}
			{...hostTheme}
		>
			<ProgressView
				value={Math.min(1, Math.max(0, value))}
				modifiers={[tint(String(palette.primary))]}
			/>
		</Host>
	);
}
