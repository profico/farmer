import { useEffect } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "../../ui/components";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";

export type Notice = {
	/** Changes for each new notice, so the same words show again. */
	id: number;
	message: string;
	tone?: "plain" | "warning";
	action?: { label: string; onPress: () => void };
};

const SHOW_MS = 6000;

/**
 * A short message about a write that just happened, with one action such
 * as Undo. It goes away after a few seconds, and a screen reader reads it
 * out when it comes. `floating` puts it over the bottom of the screen, as
 * Material draws a snackbar; else it sits in the content.
 */
export function Snackbar({
	notice,
	onHide,
	floating = false,
}: {
	notice: Notice | null;
	onHide: () => void;
	floating?: boolean;
}) {
	const palette = usePalette();

	useEffect(() => {
		if (!notice) return;
		AccessibilityInfo.announceForAccessibility(notice.message);
		const timer = setTimeout(onHide, SHOW_MS);
		return () => clearTimeout(timer);
	}, [notice, onHide]);

	if (!notice) return null;
	const warning = notice.tone === "warning";
	const ink = warning ? palette.onErrorContainer : palette.onSurface;
	const bar = (
		<View
			accessibilityLiveRegion="polite"
			style={[
				{
					flexDirection: "row",
					alignItems: "center",
					gap: SPACE.m,
					borderRadius: 12,
					paddingLeft: SPACE.l,
					paddingRight: SPACE.s,
					paddingVertical: SPACE.s,
					minHeight: 48,
					backgroundColor: warning
						? palette.errorContainer
						: palette.surfaceContainerHigh,
				},
				floating ? { margin: SPACE.l } : null,
			]}
		>
			<View style={{ flex: 1 }}>
				<Text variant="bodyMedium" color={ink}>
					{notice.message}
				</Text>
			</View>
			{notice.action ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={notice.action.label}
					onPress={() => {
						notice.action?.onPress();
						onHide();
					}}
					hitSlop={8}
					style={{ paddingHorizontal: SPACE.m, paddingVertical: SPACE.s }}
				>
					<Text variant="labelLarge" color={palette.primary}>
						{notice.action.label}
					</Text>
				</Pressable>
			) : null}
		</View>
	);
	if (!floating) return bar;
	// A native safe area view: inside a modal the insets of the hook can be
	// zero, and the bar then sat under the gesture bar (see `forms/sheet.tsx`).
	return (
		<SafeAreaView
			edges={["bottom"]}
			pointerEvents="box-none"
			style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
		>
			{bar}
		</SafeAreaView>
	);
}
