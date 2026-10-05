import { Host } from "@expo/ui";
import type { ReactNode } from "react";

import { SEED_COLOR } from "./palette";

/**
 * The bridge to the native toolkit for one `@expo/ui` control. On Android
 * the Compose theme comes from the wallpaper by itself (`host.android.tsx`);
 * elsewhere the farmer accent is the tint.
 */
export function ControlHost({ children }: { children: ReactNode }) {
	return (
		<Host matchContents seedColor={SEED_COLOR}>
			{children}
		</Host>
	);
}
