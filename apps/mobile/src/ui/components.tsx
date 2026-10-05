import { Button } from "@expo/ui";
import { type ReactNode, useEffect, useState } from "react";
import {
	Animated,
	type ColorValue,
	Platform,
	Pressable,
	type StyleProp,
	Text as RNText,
	TextInput,
	type TextInputProps,
	View,
	type ViewStyle,
} from "react-native";

import { ControlHost } from "./host";
import { Icon } from "./icon";
import type { IconName } from "./icons";
import { usePalette } from "./theme";
import { SPACE, TYPE, type TypeVariant } from "./type";

export type TextProps = {
	variant?: TypeVariant;
	color?: ColorValue;
	numberOfLines?: number;
	align?: "left" | "center" | "right";
	children: ReactNode;
};

/** Text in the type scale, in the colour for text on a surface. */
export function Text({
	variant = "bodyLarge",
	color,
	numberOfLines,
	align,
	children,
}: TextProps) {
	const palette = usePalette();
	return (
		<RNText
			numberOfLines={numberOfLines}
			style={[
				TYPE[variant],
				{ color: color ?? palette.onSurface, textAlign: align },
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
	tone?: "surface" | "primary" | "error";
}) {
	const palette = usePalette();
	const backgroundColor =
		tone === "primary"
			? palette.primaryContainer
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
			{children}
		</View>
	);
}

export type ActionButtonProps = {
	label: string;
	onPress: () => void;
	variant?: "filled" | "outlined" | "text";
	disabled?: boolean;
};

/** The platform's own button, through `@expo/ui`. */
export function ActionButton({
	label,
	onPress,
	variant = "filled",
	disabled,
}: ActionButtonProps) {
	return (
		<ControlHost>
			<Button
				label={label}
				onPress={onPress}
				variant={variant}
				disabled={disabled}
			/>
		</ControlHost>
	);
}

/** A round button with one icon, for a toolbar or a stepper. */
export function IconButton({
	icon,
	label,
	onPress,
	disabled,
	tone = "plain",
}: {
	icon: IconName;
	/** Read out by a screen reader. */
	label: string;
	onPress: () => void;
	disabled?: boolean;
	tone?: "plain" | "filled" | "tonal";
}) {
	const palette = usePalette();
	const backgroundColor =
		tone === "filled"
			? palette.primary
			: tone === "tonal"
				? palette.secondaryContainer
				: "transparent";
	const color =
		tone === "filled"
			? palette.onPrimary
			: tone === "tonal"
				? palette.onSecondaryContainer
				: palette.onSurfaceVariant;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			disabled={disabled}
			hitSlop={4}
			android_ripple={{ color: palette.outlineVariant, borderless: true }}
			style={({ pressed }) => ({
				width: 40,
				height: 40,
				borderRadius: 20,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor,
				opacity: disabled ? 0.38 : Platform.OS === "ios" && pressed ? 0.5 : 1,
			})}
		>
			<Icon name={icon} size={22} color={color} />
		</Pressable>
	);
}

/** One row of a list: a leading icon, two lines and a trailing value. */
export function ListRow({
	icon,
	title,
	subtitle,
	trailing,
	onPress,
	selected,
}: {
	icon?: IconName;
	title: string;
	subtitle?: string;
	trailing?: ReactNode;
	onPress?: () => void;
	selected?: boolean;
}) {
	const palette = usePalette();
	return (
		<Pressable
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
				backgroundColor: selected ? palette.secondaryContainer : undefined,
				opacity: Platform.OS === "ios" && pressed ? 0.6 : 1,
			})}
		>
			{icon ? (
				<Icon name={icon} color={palette.onSurfaceVariant} size={24} />
			) : null}
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

/** A labelled text field, outlined as Material draws one. */
export function Field({
	label,
	hint,
	error,
	...input
}: TextInputProps & { label: string; hint?: string; error?: string | null }) {
	const palette = usePalette();
	return (
		<View style={{ gap: SPACE.xs }}>
			<Text variant="labelMedium" color={palette.onSurfaceVariant}>
				{label}
			</Text>
			<TextInput
				placeholderTextColor={palette.onSurfaceVariant}
				selectionColor={palette.primary}
				cursorColor={palette.primary}
				{...input}
				style={[
					TYPE.bodyLarge,
					{
						color: palette.onSurface,
						borderWidth: 1,
						borderColor: error ? palette.error : palette.outline,
						borderRadius: Platform.OS === "ios" ? 10 : 4,
						paddingHorizontal: SPACE.l,
						paddingVertical: SPACE.m,
						minHeight: input.multiline ? 88 : 52,
						textAlignVertical: input.multiline ? "top" : "center",
					},
				]}
			/>
			{error || hint ? (
				<Text
					variant="bodySmall"
					color={error ? palette.error : palette.onSurfaceVariant}
				>
					{error ?? hint}
				</Text>
			) : null}
		</View>
	);
}

/** A grey block that pulses while content loads. */
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
	const [opacity] = useState(() => new Animated.Value(0.5));
	useEffect(() => {
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
	}, [opacity]);
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
}: {
	icon: IconName;
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
			<Icon name={icon} size={40} color={palette.onSurfaceVariant} />
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
