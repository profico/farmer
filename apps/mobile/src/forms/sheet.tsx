import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Platform,
	ScrollView,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionButton, IconButton, Text } from "../ui/components";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";

/**
 * A form over a screen: a sheet on iOS, a full-screen dialog on Android.
 * Close on the left, the title, and the one action on the right, as
 * Material draws a full-screen dialog.
 */
export function Sheet({
	title,
	actionLabel,
	onAction,
	busy,
	actionDisabled,
	children,
}: {
	title: string;
	actionLabel: string;
	onAction: () => void;
	busy?: boolean;
	actionDisabled?: boolean;
	children: ReactNode;
}) {
	const palette = usePalette();
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const top = Platform.OS === "ios" ? SPACE.m : insets.top;
	return (
		<KeyboardAvoidingView
			style={{ flex: 1, backgroundColor: palette.surface }}
			behavior={Platform.OS === "ios" ? "padding" : undefined}
		>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: SPACE.s,
					paddingTop: top,
					paddingHorizontal: SPACE.s,
					paddingBottom: SPACE.s,
				}}
			>
				<IconButton icon="close" label="Close" onPress={() => router.back()} />
				<View style={{ flex: 1 }}>
					<Text variant="titleLarge" numberOfLines={1}>
						{title}
					</Text>
				</View>
				{busy ? <ActivityIndicator color={palette.primary} /> : null}
				<ActionButton
					label={actionLabel}
					onPress={onAction}
					disabled={busy || actionDisabled}
				/>
			</View>
			<ScrollView
				contentContainerStyle={{
					padding: SPACE.l,
					paddingBottom: insets.bottom + SPACE.xxl,
					gap: SPACE.xl,
				}}
				keyboardShouldPersistTaps="handled"
			>
				{children}
			</ScrollView>
		</KeyboardAvoidingView>
	);
}

/** A labelled group inside a sheet. */
export function FormSection({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	const palette = usePalette();
	return (
		<View style={{ gap: SPACE.s }}>
			<Text variant="labelLarge" color={palette.onSurfaceVariant}>
				{label}
			</Text>
			{children}
		</View>
	);
}
