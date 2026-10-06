import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import {
	SafeAreaView,
	useSafeAreaInsets,
} from "react-native-safe-area-context";

import { ActionButton, IconButton, Text } from "../ui/components";
import { LoadingIndicator } from "../ui/loading";
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
	// The bottom edge comes from a native safe area view: inside a modal the
	// insets of the hook can be zero, and the end of the form then sat under
	// the gesture bar.
	return (
		<SafeAreaView
			edges={["bottom"]}
			style={{ flex: 1, backgroundColor: palette.surface }}
		>
			<KeyboardAvoidingView
				style={{ flex: 1 }}
				behavior={Platform.OS === "ios" ? "padding" : undefined}
			>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: SPACE.s,
						paddingTop: top,
						paddingLeft: SPACE.s,
						paddingRight: Platform.OS === "android" ? SPACE.l : SPACE.s,
						paddingBottom: SPACE.s,
					}}
				>
					<IconButton
						icon="close"
						label="Close"
						onPress={() => router.back()}
					/>
					<View style={{ flex: 1 }}>
						<Text variant="titleLarge" numberOfLines={1}>
							{title}
						</Text>
					</View>
					{busy ? <LoadingIndicator size={24} color={palette.primary} /> : null}
					<ActionButton
						label={actionLabel}
						onPress={onAction}
						disabled={busy || actionDisabled}
					/>
				</View>
				<ScrollView
					contentContainerStyle={{
						padding: SPACE.l,
						paddingBottom: SPACE.xxl,
						gap: SPACE.xl,
					}}
					keyboardShouldPersistTaps="handled"
				>
					{children}
				</ScrollView>
			</KeyboardAvoidingView>
		</SafeAreaView>
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
			{/* Android names a section as the Expressive settings lists do. */}
			{Platform.OS === "android" ? (
				<Text variant="titleSmallEmphasized" color={palette.primary}>
					{label}
				</Text>
			) : (
				<Text variant="labelLarge" color={palette.onSurfaceVariant}>
					{label}
				</Text>
			)}
			{children}
		</View>
	);
}
