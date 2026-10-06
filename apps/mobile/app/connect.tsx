import { normalizeOrigin } from "@farmer/api-client";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Platform, View } from "react-native";

import { useSession } from "../src/session/session";
import { ActionButton, Text } from "../src/ui/components";
import { Inset, Screen } from "../src/ui/screen";
import { usePalette } from "../src/ui/theme";
import { SPACE } from "../src/ui/type";

const originOrNull = (value: string | undefined) => {
	if (!value) return null;
	try {
		return normalizeOrigin(value);
	} catch {
		return null;
	}
};

/**
 * `farmer://connect?server=<address>`, from a link or a QR code on the web.
 * It fills in the Server screen; the person still confirms it.
 */
export default function ConnectScreen() {
	const palette = usePalette();
	const router = useRouter();
	const { state, signOut } = useSession();
	const params = useLocalSearchParams<{ server?: string }>();
	const origin = originOrNull(params.server);

	if (state.status !== "signed_in") {
		return origin ? (
			<Redirect href={{ pathname: "/server", params: { server: origin } }} />
		) : (
			<Redirect href="/server" />
		);
	}
	if (!origin || origin === state.session.origin) return <Redirect href="/" />;

	// Signed in to another Server. The app keeps one at a time, so this needs
	// a sign-out, and that is the person's decision.
	return (
		<Screen title="Another server">
			<Inset>
				<Text variant="bodyLarge" color={palette.onSurfaceVariant}>
					The link is for {origin}, but you are signed in to{" "}
					{state.session.origin}. The app uses one server at a time.
				</Text>
				<View
					style={{
						flexDirection: Platform.OS === "ios" ? "column" : "row",
						gap: SPACE.m,
					}}
				>
					<ActionButton
						wide
						label="Sign out and connect"
						onPress={() =>
							void signOut().then(() =>
								router.replace({
									pathname: "/server",
									params: { server: origin },
								}),
							)
						}
					/>
					<ActionButton
						wide
						label="Stay"
						variant="text"
						onPress={() => router.replace("/")}
					/>
				</View>
			</Inset>
		</Screen>
	);
}
