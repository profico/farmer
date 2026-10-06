import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "../../ui/components";
import { EASE_OUT, MOTION_MS, useMotionPreference } from "../../ui/motion";
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
/** How far the bar moves as it enters and exits, in dp. */
const RISE = 16;

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
	lift = 0,
}: {
	notice: Notice | null;
	onHide: () => void;
	floating?: boolean;
	/** How far a floating bar sits above the bottom, in dp: the space of a
	 *  floating action button under it. */
	lift?: number;
}) {
	const palette = usePalette();
	const { reduceMotion } = useMotionPreference();
	const [progress] = useState(() => new Animated.Value(0));
	// The notice on screen. It stays while the bar exits, after `notice`
	// is already null.
	const [shown, setShown] = useState<Notice | null>(notice);

	useEffect(() => {
		if (!notice) return;
		AccessibilityInfo.announceForAccessibility(notice.message);
		const timer = setTimeout(onHide, SHOW_MS);
		return () => clearTimeout(timer);
	}, [notice, onHide]);

	useEffect(() => {
		if (notice) setShown(notice);
		const animation = Animated.timing(progress, {
			toValue: notice ? 1 : 0,
			duration: notice ? MOTION_MS.enter : MOTION_MS.exit,
			easing: EASE_OUT,
			useNativeDriver: true,
		});
		animation.start(({ finished }) => {
			if (finished && !notice) setShown(null);
		});
		return () => animation.stop();
	}, [notice, progress]);

	if (!shown) return null;
	const warning = shown.tone === "warning";
	// Material draws a snackbar in the inverse colours, so that it stands
	// out from the cards under it. The palette has no inverse roles, and
	// the surface and its ink, swapped, are the same pair.
	const ink = warning ? palette.onErrorContainer : palette.surface;
	const motion = {
		opacity: progress,
		transform: [
			{
				translateY: progress.interpolate({
					inputRange: [0, 1],
					outputRange: [reduceMotion ? 0 : RISE, 0],
				}),
			},
		],
	};
	const bar = (
		<Animated.View
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
					backgroundColor: warning ? palette.errorContainer : palette.onSurface,
					elevation: 3,
				},
				floating ? { margin: SPACE.l } : null,
				motion,
			]}
		>
			<View style={{ flex: 1 }}>
				<Text variant="bodyMedium" color={ink}>
					{shown.message}
				</Text>
			</View>
			{shown.action ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={shown.action.label}
					onPress={() => {
						shown.action?.onPress();
						onHide();
					}}
					hitSlop={8}
					style={{ paddingHorizontal: SPACE.m, paddingVertical: SPACE.s }}
				>
					<Text
						variant="labelLarge"
						color={warning ? palette.primary : palette.primaryContainer}
					>
						{shown.action.label}
					</Text>
				</Pressable>
			) : null}
		</Animated.View>
	);
	if (!floating) return bar;
	// A native safe area view: inside a modal the insets of the hook can be
	// zero, and the bar then sat under the gesture bar (see `forms/sheet.tsx`).
	return (
		<SafeAreaView
			edges={["bottom"]}
			pointerEvents="box-none"
			style={{ position: "absolute", left: 0, right: 0, bottom: lift }}
		>
			{bar}
		</SafeAreaView>
	);
}
