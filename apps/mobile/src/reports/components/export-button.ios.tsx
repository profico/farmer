import { useState } from "react";
import { Pressable } from "react-native";

import { Text } from "../../ui/components";
import { showDialog } from "../../ui/dialog";
import { Icon } from "../../ui/icon";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import type { Csv } from "../csv";
import { shareCsv } from "../share";

/**
 * "Export CSV" as a plain button with the share symbol, as iOS draws an
 * action that opens the share sheet. `name` has no extension. Android draws
 * an outlined button (`export-button.tsx`).
 */
export function ExportButton({
	name,
	build,
	disabled,
}: {
	name: string;
	/** Null while the rows load. */
	build: (() => Csv) | null;
	disabled?: boolean;
}) {
	const palette = usePalette();
	const [busy, setBusy] = useState(false);
	const off = disabled || busy || !build;
	const run = () => {
		if (!build) return;
		setBusy(true);
		shareCsv(name, build())
			.catch((error: Error) =>
				showDialog("Could not export", error.message || "Try again."),
			)
			.finally(() => setBusy(false));
	};
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel="Export CSV"
			accessibilityState={{ disabled: off }}
			disabled={off}
			onPress={run}
			hitSlop={8}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.xs,
				minHeight: 44,
				opacity: off ? 0.4 : pressed ? 0.6 : 1,
			})}
		>
			<Icon name="share" size={17} color={palette.primary} />
			<Text variant="bodyLarge" color={palette.primary}>
				Export CSV
			</Text>
		</Pressable>
	);
}
