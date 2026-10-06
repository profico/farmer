import { assertUsable, fetchMeta, normalizeOrigin } from "@farmer/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";

import { transportFor } from "../src/api/transport";
import { APP_VERSION } from "../src/config";
import { QrScanner } from "../src/session/qr-scanner";
import { useSession } from "../src/session/session";
import { FarmerLogo } from "../src/ui/brand";
import { ActionButton, ErrorBanner, Field, Text } from "../src/ui/components";
import { LoadingIndicator } from "../src/ui/loading";
import { Inset, Screen } from "../src/ui/screen";
import { usePalette } from "../src/ui/theme";
import { SPACE } from "../src/ui/type";

const IOS = Platform.OS === "ios";

/**
 * The first screen: which Server to use. The app keeps one at a time
 * (ADR 0005), and checks the address with `GET /api/v1/meta` before it
 * offers a sign-in. The person types the address, or scans the QR code that
 * the web app shows.
 */
export default function ServerScreen() {
	const palette = usePalette();
	const router = useRouter();
	const { state } = useSession();
	const params = useLocalSearchParams<{ server?: string }>();
	const lastOrigin = state.status === "signed_out" ? state.lastOrigin : null;
	const [address, setAddress] = useState(params.server ?? lastOrigin ?? "");
	const [checking, setChecking] = useState(false);
	const [scanning, setScanning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const connect = async (input: string) => {
		setError(null);
		setChecking(true);
		try {
			const origin = normalizeOrigin(input);
			const meta = await fetchMeta(transportFor(origin));
			assertUsable(meta, origin, APP_VERSION);
			router.push({ pathname: "/sign-in", params: { server: origin } });
		} catch (failure) {
			setError(
				failure instanceof Error ? failure.message : "Something went wrong.",
			);
		} finally {
			setChecking(false);
		}
	};

	return (
		<Screen>
			<Inset>
				<View style={{ paddingTop: SPACE.xxl, gap: SPACE.m }}>
					<FarmerLogo height={40} />
					<Text variant="headlineMedium">Connect to your server</Text>
					<Text variant="bodyLarge" color={palette.onSurfaceVariant}>
						Enter the address of your Farmer server. It is the address you open
						Farmer at in a browser.
					</Text>
				</View>
				<Field
					label="Server address"
					value={address}
					onChangeText={setAddress}
					placeholder="farmer.example.com"
					keyboardType="url"
					autoCapitalize="none"
					autoCorrect={false}
					autoComplete="url"
					returnKeyType="go"
					onSubmitEditing={() => void connect(address)}
					editable={!checking}
					// iOS shows an error as the footer of the field.
					error={IOS ? error : undefined}
					textContentType="URL"
				/>
				{error && !IOS ? <ErrorBanner message={error} /> : null}
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m }}
				>
					<ActionButton
						wide
						label="Continue"
						onPress={() => void connect(address)}
						disabled={checking || !address.trim()}
					/>
					{checking ? (
						<LoadingIndicator size={24} color={palette.primary} />
					) : null}
				</View>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: SPACE.s,
						paddingTop: SPACE.s,
					}}
				>
					<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
						Farmer on the web can show a QR code.
					</Text>
				</View>
				<View style={{ flexDirection: "row" }}>
					<ActionButton
						wide
						label="Scan QR code"
						variant="outlined"
						onPress={() => setScanning(true)}
						disabled={checking}
					/>
				</View>
			</Inset>
			<QrScanner
				visible={scanning}
				onClose={() => setScanning(false)}
				onServer={(origin) => {
					setScanning(false);
					setAddress(origin);
					void connect(origin);
				}}
			/>
		</Screen>
	);
}
