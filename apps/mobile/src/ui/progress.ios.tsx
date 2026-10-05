import { Host, ProgressView } from "@expo/ui/swift-ui";
import { tint } from "@expo/ui/swift-ui/modifiers";

import { SEED_COLOR } from "./palette";
import type { ProgressBarProps } from "./progress";

export function ProgressBar({ value }: ProgressBarProps) {
	return (
		<Host matchContents={{ vertical: true }} style={{ alignSelf: "stretch" }}>
			<ProgressView
				value={Math.min(1, Math.max(0, value))}
				modifiers={[tint(SEED_COLOR)]}
			/>
		</Host>
	);
}
