import { Stack, useRouter } from "expo-router";
import { KeyboardAvoidingView, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import type { SheetProps } from "./sheet";

export { FormGroup } from "./form-group";
export { FormSection } from "./form-section";

/**
 * A form in a sheet, with the navigation bar of the system: the title in
 * the middle, Cancel as a text button on the left, and the action as the
 * bold, tinted button on the right. The action stays disabled until the
 * form is valid. The form scrolls under the bar, which the system blurs.
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
	return (
		<>
			<Stack.Screen
				options={{
					headerShown: true,
					title,
					headerTransparent: true,
					headerShadowVisible: false,
					headerStyle: { backgroundColor: "transparent" },
					headerTitleStyle: { color: String(palette.onSurface) },
				}}
			>
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
			</SafeAreaView>
		</>
	);
}
