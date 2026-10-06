import { type ReactNode, useEffect, useRef, useState } from "react";
import { Platform, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "./components";
import { usePalette } from "./theme";
import { SPACE } from "./type";

/** How long the spinner of a pull waits for a fetch to start. */
const PULL_GRACE_MS = 1000;

/**
 * The spinner of a pull to refresh. It shows from the pull until the fetch
 * that the pull started ends. A refetch that the person did not start (a
 * save, the app coming back) shows no spinner.
 */
export function usePullToRefresh(
	refreshing: boolean,
	onRefresh: (() => void) | undefined,
) {
	const [pulled, setPulled] = useState(false);
	const seen = useRef(false);
	useEffect(() => {
		if (!pulled) return;
		if (refreshing) {
			seen.current = true;
			return;
		}
		if (seen.current) {
			seen.current = false;
			setPulled(false);
			return;
		}
		const timer = setTimeout(() => setPulled(false), PULL_GRACE_MS);
		return () => clearTimeout(timer);
	}, [pulled, refreshing]);
	return {
		refreshing: pulled,
		onRefresh: () => {
			seen.current = false;
			setPulled(true);
			onRefresh?.();
		},
	};
}

export type ScreenProps = {
	title?: string;
	/** A line above the title, such as the workspace. */
	overline?: string;
	/** Controls at the end of the title row. */
	actions?: ReactNode;
	refreshing?: boolean;
	onRefresh?: () => void;
	/** False under a navigation header, which already clears the status bar. */
	topInset?: boolean;
	/** Space below the last row, for a floating button over the list. */
	bottomSpace?: number;
	/** The vertical scroll offset, on each scroll event. */
	onScrollOffset?: (offset: number) => void;
	children: ReactNode;
};

/** A scrolling screen with a large title, as both platforms draw a top
 *  level screen. */
export function Screen({
	title,
	overline,
	actions,
	refreshing,
	onRefresh,
	topInset = true,
	bottomSpace = 0,
	onScrollOffset,
	children,
}: ScreenProps) {
	const palette = usePalette();
	const insets = useSafeAreaInsets();
	const pull = usePullToRefresh(refreshing ?? false, onRefresh);
	return (
		<View style={{ flex: 1, backgroundColor: palette.background }}>
			<ScrollView
				style={{ flex: 1, backgroundColor: palette.background }}
				contentContainerStyle={{
					paddingTop: (topInset ? insets.top : 0) + SPACE.s,
					paddingBottom: insets.bottom + SPACE.xxl + bottomSpace,
					gap: SPACE.l,
				}}
				onScroll={
					onScrollOffset
						? (event) => onScrollOffset(event.nativeEvent.contentOffset.y)
						: undefined
				}
				scrollEventThrottle={onScrollOffset ? 32 : undefined}
				contentInsetAdjustmentBehavior="never"
				keyboardShouldPersistTaps="handled"
				refreshControl={
					onRefresh ? (
						<RefreshControl
							refreshing={pull.refreshing}
							onRefresh={pull.onRefresh}
							// Android: start the spinner below the status bar band.
							progressViewOffset={topInset ? insets.top : 0}
							colors={[String(palette.primary)]}
							progressBackgroundColor={String(palette.surfaceContainerHigh)}
							tintColor={palette.primary}
						/>
					) : undefined
				}
			>
				{title ? (
					<View
						style={{
							flexDirection: "row",
							alignItems: "flex-end",
							paddingHorizontal: SPACE.l,
							gap: SPACE.s,
						}}
					>
						<View style={{ flex: 1 }}>
							{overline ? (
								<Text variant="labelLarge" color={palette.onSurfaceVariant}>
									{overline}
								</Text>
							) : null}
							<Text
								variant={
									Platform.OS === "android"
										? "headlineMediumEmphasized"
										: "headlineMedium"
								}
								numberOfLines={1}
							>
								{title}
							</Text>
						</View>
						{actions}
					</View>
				) : null}
				{children}
			</ScrollView>
			{topInset ? (
				// The status bar is transparent (edge to edge). Without this
				// band, the content scrolls under the clock and the icons.
				<View
					pointerEvents="none"
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						height: insets.top,
						backgroundColor: palette.background,
					}}
				/>
			) : null}
		</View>
	);
}

/** Horizontal padding for content inside a `Screen`. */
export function Inset({ children }: { children: ReactNode }) {
	return (
		<View style={{ paddingHorizontal: SPACE.l, gap: SPACE.m }}>{children}</View>
	);
}
