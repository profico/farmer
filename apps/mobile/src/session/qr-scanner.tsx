import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { Linking, Modal, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionButton, IconButton, Text } from "../ui/components";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import { serverFromScan } from "./server-address";

/**
 * A full-screen camera that reads one QR code: the web app's "Open in the
 * mobile app" code, or a code with a plain https address. Any other code
 * shows a line and the camera keeps looking.
 */
export function QrScanner({
	visible,
	onClose,
	onServer,
}: {
	visible: boolean;
	onClose: () => void;
	onServer: (origin: string) => void;
}) {
	const palette = usePalette();
	const insets = useSafeAreaInsets();
	const [permission, requestPermission] = useCameraPermissions();
	const [notServer, setNotServer] = useState(false);
	// The camera reports the same code many times a second. One answer is
	// enough.
	const done = useRef(false);

	const onScan = (data: string) => {
		if (done.current) return;
		const origin = serverFromScan(data);
		if (!origin) {
			setNotServer(true);
			return;
		}
		done.current = true;
		onServer(origin);
	};

	const granted = permission?.granted === true;

	return (
		<Modal
			visible={visible}
			animationType="slide"
			presentationStyle={Platform.OS === "ios" ? "fullScreen" : undefined}
			onRequestClose={onClose}
			onShow={() => {
				done.current = false;
				setNotServer(false);
				if (!permission?.granted && permission?.canAskAgain !== false) {
					void requestPermission();
				}
			}}
		>
			<View style={{ flex: 1, backgroundColor: palette.background }}>
				{granted ? (
					<CameraView
						style={{ flex: 1 }}
						facing="back"
						barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
						onBarcodeScanned={(result) => onScan(result.data)}
					/>
				) : (
					<View
						style={{
							flex: 1,
							justifyContent: "center",
							padding: SPACE.xl,
							gap: SPACE.l,
							backgroundColor: palette.background,
						}}
					>
						<Text variant="titleLarge">Allow the camera</Text>
						<Text variant="bodyLarge" color={palette.onSurfaceVariant}>
							The app needs the camera to read the QR code of your server. It
							reads only the code, and keeps no picture.
						</Text>
						{permission && !permission.canAskAgain ? (
							<ActionButton
								label="Open the settings"
								onPress={() => void Linking.openSettings()}
							/>
						) : (
							<ActionButton
								label="Allow the camera"
								onPress={() => void requestPermission()}
							/>
						)}
					</View>
				)}
				<View
					style={{
						position: "absolute",
						top: insets.top + SPACE.s,
						left: SPACE.s,
						right: SPACE.s,
						flexDirection: "row",
						alignItems: "center",
					}}
				>
					<IconButton
						icon="close"
						label="Close"
						tone="tonal"
						onPress={onClose}
					/>
				</View>
				{granted ? (
					<View
						style={{
							position: "absolute",
							left: SPACE.l,
							right: SPACE.l,
							bottom: insets.bottom + SPACE.xl,
							padding: SPACE.m,
							borderRadius: 14,
							backgroundColor: palette.surfaceContainerHigh,
						}}
					>
						<Text variant="bodyLarge" align="center">
							{notServer
								? "This code does not hold a server address. Scan the code in Farmer on the web."
								: "Point the camera at the QR code that Farmer shows on the web."}
						</Text>
					</View>
				) : null}
			</View>
		</Modal>
	);
}
