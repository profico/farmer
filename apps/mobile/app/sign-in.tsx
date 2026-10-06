import {
	assertUsable,
	type DeviceCode,
	FarmerClient,
	fetchMeta,
	formatUserCode,
	pollForToken,
	requestDeviceCode,
	type SignInMethod,
} from "@farmer/api-client";
import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";

import { transportFor } from "../src/api/transport";
import { APP_VERSION } from "../src/config";
import { FormGroup, GroupCaption } from "../src/forms/form-group";
import { API_TOKEN_PREFIX } from "../src/session/credential";
import {
	type SignInOutcome,
	signInWithPassword,
	signInWithProvider,
} from "../src/session/provider-sign-in";
import { signInOrigin } from "../src/session/server-address";
import { useSession } from "../src/session/session";
import { FarmerMark } from "../src/ui/brand";
import {
	ActionButton,
	Card,
	ErrorBanner,
	Field,
	IconButton,
	Text,
} from "../src/ui/components";
import { Icon } from "../src/ui/icon";
import { LoadingIndicator } from "../src/ui/loading";
import { Inset, Screen } from "../src/ui/screen";
import { usePalette } from "../src/ui/theme";
import { SPACE } from "../src/ui/type";

const IOS = Platform.OS === "ios";

const openApproval = (url: string) =>
	WebBrowser.openBrowserAsync(url, {
		// Android: a Custom Tab in the app's own task, so Back returns here.
		createTask: false,
		showTitle: true,
	}).catch(() => undefined);

/**
 * Sign-in. The server lists its methods in `/meta`: one button for each
 * provider, and the email and password form when it offers one (ADR 0005).
 * Two fallbacks stay for every server: the device flow in the browser, as
 * `farmer login` does, and an API token from Preferences.
 */
export default function SignInScreen() {
	const palette = usePalette();
	const router = useRouter();
	const { signIn } = useSession();
	const params = useLocalSearchParams<{ server?: string }>();
	// A deep link can set the parameter too, so it gets the Server screen's
	// checks: the address, and then `/meta` with `assertUsable`.
	const server = signInOrigin(params.server);
	const meta = useQuery({
		queryKey: ["farmer", server ?? "", "meta", "usable"],
		queryFn: async () => {
			const origin = server ?? "";
			const answer = await fetchMeta(transportFor(origin));
			assertUsable(answer, origin, APP_VERSION);
			return answer;
		},
		enabled: Boolean(server),
		staleTime: 60_000,
	});
	const [code, setCode] = useState<DeviceCode | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [token, setToken] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showOthers, setShowOthers] = useState(false);
	// Each attempt has a number. A poll stops once a newer attempt, a cancel
	// or leaving the screen changed it.
	const attempt = useRef(0);

	useEffect(
		() => () => {
			attempt.current += 1;
		},
		[],
	);

	if (!server) {
		return params.server ? (
			<Redirect
				href={{ pathname: "/server", params: { server: params.server } }}
			/>
		) : (
			<Redirect href="/server" />
		);
	}
	const transport = transportFor(server);

	const providers: SignInMethod[] = meta.data?.signInMethods ?? [];
	const passwordForm = meta.data?.passwordSignIn === true;
	const hasMethods = providers.length > 0 || passwordForm;

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

	/** The end of a provider or a password sign-in. */
	const settle = async (outcome: SignInOutcome) => {
		if (outcome.kind === "cancelled") {
			setBusy(false);
			return;
		}
		if (outcome.kind === "error") {
			setError(outcome.message);
			setBusy(false);
			return;
		}
		try {
			await finish(outcome.token);
		} catch (failure) {
			fail(failure instanceof Error ? failure : new Error(String(failure)));
		}
	};

	const withProvider = async (method: SignInMethod) => {
		setError(null);
		setBusy(true);
		attempt.current += 1;
		await settle(
			await signInWithProvider(
				server,
				method,
				meta.data?.signInExchange === true,
			),
		);
	};

	const withPassword = async () => {
		setError(null);
		if (!email.trim() || !password) {
			setError("Enter your email and your password.");
			return;
		}
		setBusy(true);
		attempt.current += 1;
		await settle(await signInWithPassword(server, email.trim(), password));
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

	const browserCard = IOS ? (
		<View style={{ gap: SPACE.s }}>
			<ActionButton
				wide
				label="Sign in with the browser"
				variant={hasMethods ? "outlined" : "filled"}
				onPress={() => void withBrowser()}
				disabled={busy}
			/>
			<GroupCaption>
				Sign in on the server's own page, with any method it offers.
			</GroupCaption>
		</View>
	) : (
		<Card>
			<View
				style={{ flexDirection: "row", gap: SPACE.m, alignItems: "center" }}
			>
				<Icon name="browser" color={palette.primary} />
				<Text variant="titleMedium">Sign in with the browser</Text>
			</View>
			<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
				Sign in on the server's own page, with any method it offers.
			</Text>
			<ActionButton
				label="Sign in with the browser"
				variant={hasMethods ? "outlined" : "filled"}
				onPress={() => void withBrowser()}
				disabled={busy}
			/>
		</Card>
	);

	const tokenField = (
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
	);

	const tokenCard = IOS ? (
		<View style={{ gap: SPACE.m }}>
			{tokenField}
			<ActionButton
				wide
				label="Sign in with the token"
				variant="outlined"
				onPress={() => void withToken()}
				disabled={busy || !token.trim()}
			/>
		</View>
	) : (
		<Card>
			<View
				style={{ flexDirection: "row", gap: SPACE.m, alignItems: "center" }}
			>
				<Icon name="key" color={palette.primary} />
				<Text variant="titleMedium">Use an API token</Text>
			</View>
			{tokenField}
			<ActionButton
				label="Sign in with the token"
				variant="outlined"
				onPress={() => void withToken()}
				disabled={busy || !token.trim()}
			/>
		</Card>
	);

	const waitingCard = code ? (
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
				style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m }}
			>
				<LoadingIndicator size={24} color={palette.onPrimaryContainer} />
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
	) : null;

	const emailField = (
		<Field
			label="Email"
			value={email}
			onChangeText={setEmail}
			placeholder="you@example.com"
			keyboardType="email-address"
			autoCapitalize="none"
			autoCorrect={false}
			autoComplete="email"
			textContentType="username"
			returnKeyType="next"
			editable={!busy}
		/>
	);
	const passwordField = (
		<Field
			label="Password"
			value={password}
			onChangeText={setPassword}
			secureTextEntry
			autoCapitalize="none"
			autoCorrect={false}
			autoComplete="current-password"
			textContentType="password"
			returnKeyType="go"
			onSubmitEditing={() => void withPassword()}
			editable={!busy}
		/>
	);
	const signInButton = (
		<ActionButton
			wide
			label="Sign in"
			variant={providers.length > 0 ? "outlined" : "filled"}
			onPress={() => void withPassword()}
			disabled={busy || !email.trim() || !password}
		/>
	);

	return (
		<Screen topInset={!IOS}>
			{/* iOS: the bar of the system, with its own back button. */}
			{IOS ? (
				<Stack.Screen
					options={{
						headerShown: true,
						title: "",
						headerBackTitle: "Server",
						headerShadowVisible: false,
						headerStyle: { backgroundColor: String(palette.background) },
					}}
				/>
			) : null}
			<Inset>
				{IOS ? null : (
					<View style={{ flexDirection: "row", alignItems: "center" }}>
						<IconButton
							icon="back"
							label="Change the server"
							onPress={() => router.back()}
						/>
					</View>
				)}
				<View style={{ gap: SPACE.xs }}>
					<FarmerMark size={48} />
					<Text variant="headlineMedium">Sign in</Text>
					<Text variant="bodyLarge" color={palette.onSurfaceVariant}>
						{server}
					</Text>
				</View>
				{error ? <ErrorBanner message={error} /> : null}

				{meta.isPending ? (
					<View style={{ paddingVertical: SPACE.xl, alignItems: "center" }}>
						<LoadingIndicator size={32} color={palette.primary} />
					</View>
				) : meta.isError ? (
					<>
						<ErrorBanner message={meta.error.message} />
						<ActionButton
							label="Change the server"
							onPress={() =>
								router.replace({ pathname: "/server", params: { server } })
							}
						/>
					</>
				) : waitingCard ? (
					waitingCard
				) : hasMethods ? (
					<>
						{providers.length > 0 ? (
							<View style={{ gap: SPACE.s }}>
								{providers.map((method) => (
									<ActionButton
										key={method.id}
										label={`Continue with ${method.name}`}
										wide
										onPress={() => void withProvider(method)}
										disabled={busy}
									/>
								))}
							</View>
						) : null}
						{passwordForm ? (
							IOS ? (
								<View style={{ gap: SPACE.m }}>
									<FormGroup>
										{emailField}
										{passwordField}
									</FormGroup>
									{signInButton}
								</View>
							) : (
								<Card>
									{emailField}
									{passwordField}
									{signInButton}
								</Card>
							)
						) : null}
						{busy ? (
							<View style={{ alignItems: "center" }}>
								<LoadingIndicator size={24} color={palette.primary} />
							</View>
						) : null}
						<View style={{ flexDirection: "row", paddingTop: SPACE.s }}>
							<ActionButton
								label={
									showOthers
										? "Hide the other ways to sign in"
										: "Other ways to sign in"
								}
								variant="text"
								wide
								onPress={() => setShowOthers((shown) => !shown)}
							/>
						</View>
						{showOthers ? (
							<>
								{browserCard}
								{tokenCard}
							</>
						) : null}
					</>
				) : (
					<>
						{browserCard}
						{tokenCard}
					</>
				)}
			</Inset>
		</Screen>
	);
}
