import {
	type DeviceCode,
	FarmerClient,
	formatUserCode,
	pollForToken,
	requestDeviceCode,
} from "@farmer/api-client";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";

import { transportFor } from "../src/api/transport";
import { useSession } from "../src/session/session";
import {
	ActionButton,
	Card,
	ErrorBanner,
	Field,
	IconButton,
	Text,
} from "../src/ui/components";
import { Icon } from "../src/ui/icon";
import { Inset, Screen } from "../src/ui/screen";
import { usePalette } from "../src/ui/theme";
import { SPACE } from "../src/ui/type";

const API_TOKEN_PREFIX = "fmr_";

const openApproval = (url: string) =>
	WebBrowser.openBrowserAsync(url, {
		// Android: a Custom Tab in the app's own task, so Back returns here.
		createTask: false,
		showTitle: true,
	}).catch(() => undefined);

/**
 * Sign-in, two ways. The browser runs the device flow, as `farmer login`
 * does: the approval page opens with the code filled in, and the app polls
 * until the person approves it. An API token is the other way, for a person
 * who made one in Preferences.
 */
export default function SignInScreen() {
	const palette = usePalette();
	const router = useRouter();
	const { signIn } = useSession();
	const { server } = useLocalSearchParams<{ server?: string }>();
	const [code, setCode] = useState<DeviceCode | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [token, setToken] = useState("");
	// Each attempt has a number. A poll stops once a newer attempt, a cancel
	// or leaving the screen changed it.
	const attempt = useRef(0);

	useEffect(
		() => () => {
			attempt.current += 1;
		},
		[],
	);

	if (!server) return <Redirect href="/server" />;
	const transport = transportFor(server);

	/** Checks a token with `GET /me`, then keeps it. */
	const finish = async (candidate: string) => {
		await new FarmerClient(transport, candidate).me();
		await signIn(server, candidate);
	};

	const fail = (failure: Error) => {
		attempt.current += 1;
		setError(failure.message);
		setCode(null);
		setBusy(false);
	};

	const withBrowser = async () => {
		setError(null);
		setBusy(true);
		attempt.current += 1;
		const mine = attempt.current;
		try {
			const started = await requestDeviceCode(transport);
			setCode(started);
			void openApproval(started.verificationUriComplete);
			// On Android the app's timers pause while the Custom Tab is in
			// front, so this poll runs again as soon as the person comes back.
			const approved = await pollForToken(transport, started, {
				now: Date.now,
				cancelled: () => attempt.current !== mine,
			});
			if (!approved) return;
			if (Platform.OS === "ios") {
				await WebBrowser.dismissBrowser().catch(() => undefined);
			}
			await finish(approved);
		} catch (failure) {
			if (attempt.current !== mine) return;
			fail(failure instanceof Error ? failure : new Error(String(failure)));
		}
	};

	const withToken = async () => {
		const candidate = token.trim();
		setError(null);
		if (!candidate.startsWith(API_TOKEN_PREFIX)) {
			setError(`An API token starts with ${API_TOKEN_PREFIX}.`);
			return;
		}
		setBusy(true);
		try {
			await finish(candidate);
		} catch (failure) {
			fail(failure instanceof Error ? failure : new Error(String(failure)));
		}
	};

	const cancel = () => {
		attempt.current += 1;
		setCode(null);
		setBusy(false);
	};

	return (
		<Screen>
			<Inset>
				<View style={{ flexDirection: "row", alignItems: "center" }}>
					<IconButton
						icon="back"
						label="Change the server"
						onPress={() => router.back()}
					/>
				</View>
				<View style={{ gap: SPACE.xs }}>
					<Text variant="headlineMedium">Sign in</Text>
					<Text variant="bodyLarge" color={palette.onSurfaceVariant}>
						{server}
					</Text>
				</View>
				{error ? <ErrorBanner message={error} /> : null}

				{code ? (
					<Card tone="primary">
						<Text variant="titleMedium" color={palette.onPrimaryContainer}>
							Approve the sign-in in the browser
						</Text>
						<Text variant="bodyMedium" color={palette.onPrimaryContainer}>
							Approve it only if the page shows this code:
						</Text>
						<Text
							variant="displaySmall"
							color={palette.onPrimaryContainer}
							align="center"
						>
							{formatUserCode(code.userCode)}
						</Text>
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: SPACE.m,
							}}
						>
							<ActivityIndicator color={palette.onPrimaryContainer} />
							<View style={{ flex: 1 }}>
								<Text variant="bodyMedium" color={palette.onPrimaryContainer}>
									Waiting for approval. Come back to the app when you are done.
								</Text>
							</View>
						</View>
						<View style={{ flexDirection: "row", gap: SPACE.s }}>
							<ActionButton
								label="Open the page again"
								variant="outlined"
								onPress={() => void openApproval(code.verificationUriComplete)}
							/>
							<ActionButton label="Cancel" variant="text" onPress={cancel} />
						</View>
					</Card>
				) : (
					<Card>
						<View
							style={{
								flexDirection: "row",
								gap: SPACE.m,
								alignItems: "center",
							}}
						>
							<Icon name="browser" color={palette.primary} />
							<Text variant="titleMedium">Sign in with the browser</Text>
						</View>
						<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
							Sign in on the server's own page, with any method it offers.
						</Text>
						<ActionButton
							label="Sign in with the browser"
							onPress={() => void withBrowser()}
							disabled={busy}
						/>
					</Card>
				)}

				<Card>
					<View
						style={{ flexDirection: "row", gap: SPACE.m, alignItems: "center" }}
					>
						<Icon name="key" color={palette.primary} />
						<Text variant="titleMedium">Use an API token</Text>
					</View>
					<Field
						label="API token"
						hint="Make one in Farmer on the web, in Preferences, API tokens."
						value={token}
						onChangeText={setToken}
						placeholder="fmr_..."
						autoCapitalize="none"
						autoCorrect={false}
						secureTextEntry
						editable={!busy}
						onSubmitEditing={() => void withToken()}
					/>
					<ActionButton
						label="Sign in with the token"
						variant="outlined"
						onPress={() => void withToken()}
						disabled={busy || !token.trim()}
					/>
				</Card>
			</Inset>
		</Screen>
	);
}
