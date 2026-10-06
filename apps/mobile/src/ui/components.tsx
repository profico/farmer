import { type ReactNode, useEffect, useState } from "react";
import {
	Animated,
	type ColorValue,
	Platform,
	Pressable,
	type StyleProp,
	Text as RNText,
	View,
	type ViewStyle,
} from "react-native";

import { ActionButton } from "./action-button";
import { Icon } from "./icon";
import { IconBadge } from "./icon-badge";
import type { IconName } from "./icons";
import { useMotionPreference } from "./motion";
import { useRowMenu } from "./row-menu";
import type { RowMenuEntry } from "./row-menu-items";
import { SurfaceColor } from "./surface-color";
import { usePalette } from "./theme";
import { SPACE, TYPE, type TypeVariant } from "./type";

export type TextProps = {
	variant?: TypeVariant;
	color?: ColorValue;
	numberOfLines?: number;
	align?: "left" | "center" | "right";
	/** Figures of one width, so a number that changes does not move. */
	numeric?: boolean;
	children: ReactNode;
};

/** Text in the type scale, in the colour for text on a surface. */
export function Text({
	variant = "bodyLarge",
	color,
	numberOfLines,
	align,
	numeric,
	children,
}: TextProps) {
	const palette = usePalette();
	return (
		<RNText
			numberOfLines={numberOfLines}
			style={[
				TYPE[variant],
				{ color: color ?? palette.onSurface, textAlign: align },
				numeric ? { fontVariant: ["tabular-nums"] } : null,
			]}
		>
			{children}
		</RNText>
	);
}

/** A surface that groups related content. */
export function Card({
	children,
	style,
	tone = "surface",
}: {
	children: ReactNode;
	style?: StyleProp<ViewStyle>;
	tone?: "surface" | "primary" | "secondary" | "error";
}) {
	const palette = usePalette();
	const backgroundColor =
		tone === "primary"
			? palette.primaryContainer
			: tone === "secondary"
				? palette.secondaryContainer
				: tone === "error"
					? palette.errorContainer
					: palette.surfaceContainer;
	return (
		<View
			style={[
				{
					backgroundColor,
					borderRadius: Platform.OS === "ios" ? 12 : 16,
					padding: SPACE.l,
					gap: SPACE.s,
				},
				style,
			]}
		>
			<SurfaceColor.Provider value={backgroundColor}>
				{children}
			</SurfaceColor.Provider>
		</View>
	);
}

export { ActionButton, type ActionButtonProps } from "./action-button";
export { IconButton } from "./icon-button";

/** One row of a list: a leading icon, two lines and a trailing value. */
export function ListRow({
	icon,
	leading,
	title,
	subtitle,
	trailing,
	onPress,
	selected,
	accessibilityLabel,
	actions,
}: {
	icon?: IconName;
	/** A mark at the start of the row, in place of `icon`. */
	leading?: ReactNode;
	title: string;
	subtitle?: string;
	trailing?: ReactNode;
	onPress?: () => void;
	selected?: boolean;
	/** What a screen reader says for the row. The title and the subtitle
	 *  when not given. */
	accessibilityLabel?: string;
	/** The menu of a long press, and the same actions for a screen reader.
	 *  The caller leaves out an action that the person may not do. */
	actions?: readonly RowMenuEntry[];
}) {
	const palette = usePalette();
	const menu = useRowMenu(title, actions ?? []);
	return (
		<Pressable
			{...menu}
			// A row that opens or picks something is one element with one label.
			// A row without a press stays open, so a button at its end is
			// reachable on its own.
			accessible={Boolean(onPress)}
			accessibilityLabel={
				onPress
					? (accessibilityLabel ??
						[title, subtitle].filter((part) => part).join(", "))
					: undefined
			}
			accessibilityRole={onPress ? "button" : undefined}
			accessibilityState={{ selected }}
			onPress={onPress}
			disabled={!onPress}
			android_ripple={{ color: palette.outlineVariant }}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.l,
				minHeight: 56,
				paddingHorizontal: SPACE.l,
				paddingVertical: SPACE.s,
				backgroundColor:
					Platform.OS === "ios" && pressed
						? palette.surfaceContainerHigh
						: selected
							? palette.secondaryContainer
							: undefined,
			})}
		>
			{leading ??
				(icon ? (
					<Icon name={icon} color={palette.onSurfaceVariant} size={24} />
				) : null)}
			<View style={{ flex: 1 }}>
				<Text variant="bodyLarge" numberOfLines={1}>
					{title}
				</Text>
				{subtitle ? (
					<Text
						variant="bodyMedium"
						color={palette.onSurfaceVariant}
						numberOfLines={2}
					>
						{subtitle}
					</Text>
				) : null}
			</View>
			{trailing}
		</Pressable>
	);
}

/** The title of a group of rows. */
export function SectionHeader({ children }: { children: string }) {
	const palette = usePalette();
	return (
		<View
			style={{
				paddingHorizontal: SPACE.l,
				paddingTop: SPACE.l,
				paddingBottom: SPACE.s,
			}}
		>
			<Text variant="titleSmall" color={palette.primary}>
				{children}
			</Text>
		</View>
	);
}

export { Field, type FieldProps } from "./field";

/** A grey block that pulses while content loads. With less motion it stays
 *  still: a pulse is not the information, the block is. */
export function Skeleton({
	height,
	width = "100%",
	radius = 12,
}: {
	height: number;
	width?: number | `${number}%`;
	radius?: number;
}) {
	const palette = usePalette();
	const { reduceMotion } = useMotionPreference();
	const [opacity] = useState(() => new Animated.Value(0.5));
	useEffect(() => {
		if (reduceMotion) {
			opacity.setValue(0.75);
			return;
		}
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(opacity, {
					toValue: 1,
					duration: 700,
					useNativeDriver: true,
				}),
				Animated.timing(opacity, {
					toValue: 0.5,
					duration: 700,
					useNativeDriver: true,
				}),
			]),
		);
		loop.start();
		return () => loop.stop();
	}, [opacity, reduceMotion]);
	return (
		<Animated.View
			accessibilityLabel="Loading"
			style={{
				height,
				width,
				borderRadius: radius,
				backgroundColor: palette.surfaceContainerHigh,
				opacity,
			}}
		/>
	);
}

/** A screen or section with nothing to show yet. */
export function EmptyState({
	icon,
	title,
	message,
	action,
	tone,
}: {
	icon: IconName;
	/** Android: the tone of the badge behind the icon. */
	tone?: "secondary" | "error";
	title: string;
	message?: string;
	action?: ReactNode;
}) {
	const palette = usePalette();
	return (
		<View
			style={{
				alignItems: "center",
				gap: SPACE.s,
				paddingVertical: SPACE.xxl,
				paddingHorizontal: SPACE.xl,
			}}
		>
			{Platform.OS === "android" ? (
				<IconBadge icon={icon} tone={tone} />
			) : (
				<Icon name={icon} size={40} color={palette.onSurfaceVariant} />
			)}
			<Text variant="titleMedium" align="center">
				{title}
			</Text>
			{message ? (
				<Text
					variant="bodyMedium"
					color={palette.onSurfaceVariant}
					align="center"
				>
					{message}
				</Text>
			) : null}
			{action}
		</View>
	);
}

/** A failed read, with the reason and a way to try again. */
export function ErrorState({
	error,
	onRetry,
}: {
	error: Error;
	onRetry?: () => void;
}) {
	return (
		<EmptyState
			icon="error"
			tone="error"
			title="Something went wrong"
			message={error.message}
			action={
				onRetry ? (
					<ActionButton label="Try again" variant="text" onPress={onRetry} />
				) : undefined
			}
		/>
	);
}

/** A line of feedback under a form, in the error colours. */
export function ErrorBanner({ message }: { message: string }) {
	const palette = usePalette();
	return (
		<View
			accessibilityRole="alert"
			style={{
				flexDirection: "row",
				gap: SPACE.m,
				alignItems: "flex-start",
				backgroundColor: palette.errorContainer,
				borderRadius: 12,
				padding: SPACE.m,
			}}
		>
			<Icon name="error" size={20} color={palette.onErrorContainer} />
			<View style={{ flex: 1 }}>
				<Text variant="bodyMedium" color={palette.onErrorContainer}>
					{message}
				</Text>
			</View>
		</View>
	);
}
