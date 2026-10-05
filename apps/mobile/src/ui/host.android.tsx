import { Host } from "@expo/ui";
import { isDynamicColorAvailable } from "@expo/ui/jetpack-compose";
import type { ReactNode } from "react";

import { SEED_COLOR } from "./palette";

export function ControlHost({ children }: { children: ReactNode }) {
	return (
		<Host
			matchContents
			seedColor={isDynamicColorAvailable ? undefined : SEED_COLOR}
		>
			{children}
		</Host>
	);
}
