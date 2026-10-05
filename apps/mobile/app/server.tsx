import { assertUsable, fetchMeta, normalizeOrigin } from "@farmer/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { transportFor } from "../src/api/transport";
import { APP_VERSION } from "../src/config";
import { useSession } from "../src/session/session";
import { ActionButton, ErrorBanner, Field, Text } from "../src/ui/components";
import { Icon } from "../src/ui/icon";
import { Inset, Screen } from "../src/ui/screen";
import { usePalette } from "../src/ui/theme";
import { SPACE } from "../src/ui/type";

/**
 * The first screen: which Server to use. The app keeps one at a time
 * (ADR 0005), and checks the address with `GET /api/v1/meta` before it
 * offers a sign-in.
 */
export default function ServerScreen() {
	const palette = usePalette();
	const router = useRouter();
	const { state } = useSession();
	const params = useLocalSearchParams<{ server?: string }>();
	const lastOrigin = state.status === "signed_out" ? state.lastOrigin : null;
	const [address, setAddress] = useState(params.server ?? lastOrigin ?? "");
	const [checking, setChecking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const connect = async () => {
		setError(null);
		setChecking(true);
		try {
			const origin = normalizeOrigin(address);
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
					<Icon name="server" size={40} color={palette.primary} />
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
					onSubmitEditing={() => void connect()}
					editable={!checking}
				/>
				{error ? <ErrorBanner message={error} /> : null}
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m }}
				>
					<ActionButton
						label="Continue"
						onPress={() => void connect()}
						disabled={checking || !address.trim()}
					/>
					{checking ? <ActivityIndicator color={palette.primary} /> : null}
				</View>
			</Inset>
		</Screen>
	);
}
