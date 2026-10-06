import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Reanimated, {
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";

import { Text } from "../../ui/components";
import { CORNER, RADIUS } from "../../ui/corner";
import { Icon } from "../../ui/icon";
import { useMotionPreference } from "../../ui/motion";
import { evenCorners, useCornerMorph } from "../../ui/press-morph";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";

/** The Material 3 FAB: 56 dp high, a corner of 16 dp. */
export const FAB_SIZE = 56;
/** The space between the FAB and the edges of the screen. */
export const FAB_MARGIN = SPACE.l;
/** The space that the FAB takes at the bottom of the screen, with its
 *  margin. A list adds it below its last row, and the snackbar rises by
 *  it. */
export const FAB_CLEARANCE = FAB_SIZE + FAB_MARGIN;

/** The width of the assistant part of the split button. */
const ASSISTANT_WIDTH = 64;
/** The space between the two parts of the split button. */
const SPLIT_GAP = 2;
/** The outer corner of a part: a full pill. */
const OUTER = FAB_SIZE / 2;
/** The corners of the leading part at rest: full outside, small inside. */
const LEADING_REST = {
	borderTopLeftRadius: OUTER,
	borderBottomLeftRadius: OUTER,
	borderTopRightRadius: CORNER.extraSmall,
	borderBottomRightRadius: CORNER.extraSmall,
} as const;
/** The corners of the trailing part at rest: small inside, full outside. */
const TRAILING_REST = {
	borderTopLeftRadius: CORNER.extraSmall,
	borderBottomLeftRadius: CORNER.extraSmall,
	borderTopRightRadius: OUTER,
	borderBottomRightRadius: OUTER,
} as const;

/** The gap between the icon and the label of an extended FAB. */
const ICON_GAP = SPACE.m;
const EASE = Easing.bezier(0.2, 0, 0, 1);
const DURATION_MS = 200;

/**
 * "Log time", the main action of the Time tab on Android: an extended FAB
 * at the bottom right. It collapses to the icon while the list scrolls
 * down and extends again on a scroll up. With less motion on, the label
 * goes and comes at once, with no change of width over time.
 *
 * When `onAssistant` is set, the FAB is a split button: the Log time part
 * and, 2 dp to its right, an icon part that opens the assistant. The
 * assistant part keeps its width when the Log time part collapses. The
 * inner corners of a part grow toward full while a finger holds it.
 */
export function LogTimeFab({
	extended,
	onPress,
	onAssistant,
}: {
	extended: boolean;
	onPress: () => void;
	onAssistant?: () => void;
}) {
	const palette = usePalette();
	const leading = useCornerMorph(
		onAssistant ? LEADING_REST : evenCorners(RADIUS.fab),
		onAssistant ? OUTER : RADIUS.fab,
	);
	const trailing = useCornerMorph(TRAILING_REST, OUTER);
	const { reduceMotion } = useMotionPreference();
	// The width of the label with its gap, measured once off screen.
	const [labelWidth, setLabelWidth] = useState(0);
	const progress = useSharedValue(extended ? 1 : 0);

	useEffect(() => {
		const target = extended ? 1 : 0;
		progress.set(
			reduceMotion
				? target
				: withTiming(target, { duration: DURATION_MS, easing: EASE }),
		);
	}, [extended, reduceMotion, progress]);

	const labelStyle = useAnimatedStyle(() => ({
		width: progress.get() * labelWidth,
		opacity: progress.get(),
	}));

	return (
		<View
			pointerEvents="box-none"
			style={{
				position: "absolute",
				right: FAB_MARGIN,
				bottom: FAB_MARGIN,
				flexDirection: "row",
				alignItems: "center",
				gap: SPLIT_GAP,
			}}
		>
			{/* The label at its full width, hidden, to measure it. */}
			<View
				pointerEvents="none"
				style={{ position: "absolute", opacity: 0, flexDirection: "row" }}
				onLayout={(event) => setLabelWidth(event.nativeEvent.layout.width)}
				importantForAccessibility="no-hide-descendants"
			>
				<View style={{ width: ICON_GAP }} />
				<Text variant="labelLarge" numberOfLines={1}>
					Log time
				</Text>
			</View>
			<Reanimated.View
				style={[
					{
						height: FAB_SIZE,
						minWidth: FAB_SIZE,
						overflow: "hidden",
						backgroundColor: palette.primaryContainer,
						elevation: 3,
					},
					leading.style,
				]}
			>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Log time"
					onPress={onPress}
					onPressIn={leading.onPressIn}
					onPressOut={leading.onPressOut}
					android_ripple={{
						color: palette.onPrimaryContainer,
						borderless: false,
					}}
					style={{
						flexDirection: "row",
						alignItems: "center",
						height: FAB_SIZE,
						minWidth: FAB_SIZE,
						paddingHorizontal: SPACE.l,
					}}
				>
					<Icon name="add" color={palette.onPrimaryContainer} />
					<Reanimated.View
						style={[{ flexDirection: "row", overflow: "hidden" }, labelStyle]}
					>
						<View style={{ width: ICON_GAP }} />
						<Text
							variant="labelLarge"
							color={palette.onPrimaryContainer}
							numberOfLines={1}
						>
							Log time
						</Text>
					</Reanimated.View>
				</Pressable>
			</Reanimated.View>
			{onAssistant ? (
				<Reanimated.View
					style={[
						{
							height: FAB_SIZE,
							width: ASSISTANT_WIDTH,
							overflow: "hidden",
							backgroundColor: palette.primaryContainer,
							elevation: 3,
						},
						trailing.style,
					]}
				>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Assistant"
						onPress={onAssistant}
						onPressIn={trailing.onPressIn}
						onPressOut={trailing.onPressOut}
						android_ripple={{
							color: palette.onPrimaryContainer,
							borderless: false,
						}}
						style={{
							height: FAB_SIZE,
							width: ASSISTANT_WIDTH,
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<Icon name="assistant" color={palette.onPrimaryContainer} />
					</Pressable>
				</Reanimated.View>
			) : null}
		</View>
	);
}

/** The scroll offset at which a change of direction counts, in dp. A
 *  smaller move is the jitter of a finger. */
const SCROLL_SLOP = 8;

/**
 * Whether the FAB is extended: it collapses on a scroll down and extends
 * on a scroll up, and it is always extended at the top of the list.
 */
export function useFabExtended() {
	const [extended, setExtended] = useState(true);
	// The offset of the last change. A ref: a scroll event must not render.
	const last = useRef(0);
	const onScroll = (offset: number) => {
		if (offset <= 0) {
			last.current = 0;
			setExtended(true);
			return;
		}
		const delta = offset - last.current;
		if (Math.abs(delta) < SCROLL_SLOP) return;
		last.current = offset;
		setExtended(delta < 0);
	};
	return { extended, onScroll };
}
