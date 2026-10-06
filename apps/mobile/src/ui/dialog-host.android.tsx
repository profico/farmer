import { BasicAlertDialog, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { useSyncExternalStore } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";

import { RADIUS } from "./corner";
import {
	currentDialog,
	dismissDialog,
	pressDialogButton,
	subscribeDialogs,
} from "./dialog-queue";
import { useHostTheme } from "./host";
import { usePalette } from "./theme";
import { SPACE, TYPE } from "./type";

/**
 * The Material 3 dialog that `showDialog` queues, one at a time. The window
 * is Compose, so it draws above a form sheet. The content is React Native, as
 * in the row menu sheet. A dialog that a button opens waits in the queue and
 * shows after this one closes.
 */
export function DialogHost() {
	const dialog = useSyncExternalStore(subscribeDialogs, currentDialog);
	const palette = usePalette();
	const hostTheme = useHostTheme();
	const { width: screenWidth } = useWindowDimensions();
	if (!dialog) return null;
	return (
		<Host style={{ position: "absolute", width: 0, height: 0 }} {...hostTheme}>
			<BasicAlertDialog
				// A new key gives each dialog its own window and its own state.
				key={dialog.id}
				onDismissRequest={() => dismissDialog(dialog.id)}
				properties={{
					dismissOnBackPress: dialog.cancelable,
					dismissOnClickOutside: dialog.cancelable,
					// The width is set below, so a long text wraps in the dialog.
					usePlatformDefaultWidth: false,
				}}
			>
				<RNHostView matchContents>
					<View
						style={{
							// 24dp of margin each side, at most 560dp (Material 3).
							width: Math.min(screenWidth - 2 * SPACE.xl, 560),
							padding: SPACE.xl,
							borderRadius: RADIUS.dialog,
							backgroundColor: palette.surfaceContainerHigh,
						}}
					>
						<Text
							accessibilityRole="header"
							style={[TYPE.headlineSmall, { color: palette.onSurface }]}
						>
							{dialog.title}
						</Text>
						{dialog.message ? (
							<Text
								style={[
									TYPE.bodyMedium,
									{ color: palette.onSurfaceVariant, marginTop: SPACE.l },
								]}
							>
								{dialog.message}
							</Text>
						) : null}
						<View
							style={{
								flexDirection: "row",
								flexWrap: "wrap",
								justifyContent: "flex-end",
								gap: SPACE.s,
								marginTop: SPACE.xl,
							}}
						>
							{dialog.buttons.map((button, index) => {
								const color =
									button.style === "destructive"
										? palette.error
										: palette.primary;
								return (
									<Pressable
										// The buttons never change while the dialog shows.
										key={button.text ?? "button"}
										accessibilityRole="button"
										onPress={() => pressDialogButton(dialog.id, index)}
										android_ripple={{ color: palette.outlineVariant }}
										style={{
											minHeight: 40,
											justifyContent: "center",
											paddingHorizontal: SPACE.m,
											borderRadius: RADIUS.button,
										}}
									>
										<Text
											style={[
												TYPE.labelLarge,
												{
													color,
													fontWeight: button.style === "cancel" ? "500" : "700",
												},
											]}
										>
											{button.text}
										</Text>
									</Pressable>
								);
							})}
						</View>
					</View>
				</RNHostView>
			</BasicAlertDialog>
		</Host>
	);
}
