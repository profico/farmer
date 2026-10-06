import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet } from "react-native";
import Animated, { FadeIn, SlideInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { useMotionPreference } from "../ui/motion";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import type { SheetProps } from "./sheet";
import { type SheetPage, SheetPageContext } from "./sheet-page";

export { FormCluster, FormPart } from "./form-cluster";
export { FormGroup } from "./form-group";
export { FormSection } from "./form-section";

/**
 * A form in a sheet, with the navigation bar of the system: the title in
 * the middle, Cancel as a text button on the left, and the action as the
 * bold, tinted button on the right. The action stays disabled until the
 * form is valid. The form scrolls under the bar, which the system blurs.
 *
 * A control in the form can push a page inside the sheet, such as the list
 * of projects. The page takes the bar: a back button, its title and a
 * search field. The form stays under it.
 */
export function Sheet({
	title,
	actionLabel,
	onAction,
	busy,
	actionDisabled,
	children,
}: SheetProps) {
	const palette = usePalette();
	const router = useRouter();
	const { reduceMotion } = useMotionPreference();
	const [page, showPage] = useState<SheetPage | null>(null);
	return (
		<SheetPageContext value={showPage}>
			<Stack.Screen
				options={{
					headerShown: true,
					title: page ? page.title : title,
					headerTransparent: true,
					headerShadowVisible: false,
					headerStyle: { backgroundColor: "transparent" },
					headerTitleStyle: { color: String(palette.onSurface) },
				}}
			>
				{page ? (
					<>
						<Stack.Toolbar placement="left">
							<Stack.Toolbar.Button
								icon="chevron.left"
								accessibilityLabel="Back"
								onPress={page.onBack}
							/>
						</Stack.Toolbar>
						<Stack.SearchBar
							placeholder={page.placeholder}
							autoCapitalize="none"
							hideWhenScrolling={false}
							onChangeText={(event) => page.onSearch(event.nativeEvent.text)}
						/>
					</>
				) : (
					<>
						<Stack.Toolbar placement="left">
							<Stack.Toolbar.Button onPress={() => router.back()}>
								Cancel
							</Stack.Toolbar.Button>
						</Stack.Toolbar>
						<Stack.Toolbar placement="right">
							<Stack.Toolbar.Button
								variant="done"
								tintColor={palette.primary}
								disabled={busy || actionDisabled}
								onPress={onAction}
							>
								{actionLabel}
							</Stack.Toolbar.Button>
						</Stack.Toolbar>
					</>
				)}
			</Stack.Screen>
			{/* The bottom edge comes from a native safe area view: inside a
			    sheet the insets of the hook can be zero. */}
			<SafeAreaView
				edges={["bottom"]}
				style={{ flex: 1, backgroundColor: palette.background }}
			>
				<KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
					<ScrollView
						contentInsetAdjustmentBehavior="automatic"
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
				{page ? (
					<Animated.View
						// The page comes in from the side, as a push does.
						entering={
							reduceMotion ? FadeIn.duration(150) : SlideInRight.duration(280)
						}
						style={[
							StyleSheet.absoluteFill,
							{ backgroundColor: palette.background },
						]}
					>
						{page.content}
					</Animated.View>
				) : null}
			</SafeAreaView>
		</SheetPageContext>
	);
}
