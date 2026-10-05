import type { ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "./components";
import { usePalette } from "./theme";
import { SPACE } from "./type";

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
	children,
}: ScreenProps) {
	const palette = usePalette();
	const insets = useSafeAreaInsets();
	return (
		<ScrollView
			style={{ flex: 1, backgroundColor: palette.background }}
			contentContainerStyle={{
				paddingTop: (topInset ? insets.top : 0) + SPACE.s,
				paddingBottom: insets.bottom + SPACE.xxl,
				gap: SPACE.l,
			}}
			contentInsetAdjustmentBehavior="never"
			keyboardShouldPersistTaps="handled"
			refreshControl={
				onRefresh ? (
					<RefreshControl
						refreshing={refreshing ?? false}
						onRefresh={onRefresh}
						colors={[String(palette.primary)]}
						progressBackgroundColor={String(palette.surfaceContainerHigh)}
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
						<Text variant="headlineMedium" numberOfLines={1}>
							{title}
						</Text>
					</View>
					{actions}
				</View>
			) : null}
			{children}
		</ScrollView>
	);
}

/** Horizontal padding for content inside a `Screen`. */
export function Inset({ children }: { children: ReactNode }) {
	return (
		<View style={{ paddingHorizontal: SPACE.l, gap: SPACE.m }}>{children}</View>
	);
}
