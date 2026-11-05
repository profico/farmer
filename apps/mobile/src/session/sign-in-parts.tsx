import {
	type DeviceCode,
	formatUserCode,
	type SignInMethod,
} from "@farmer/api-client";
import { Stack } from "expo-router";
import { Platform, View } from "react-native";

import { FormGroup, GroupCaption } from "../forms/form-group";
import { ActionButton, Card, Field, Text } from "../ui/components";
import { Icon } from "../ui/icon";
import { LoadingIndicator } from "../ui/loading";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import { openApproval, type SignInFlow } from "./sign-in-flow";

export const IOS = Platform.OS === "ios";

/** iOS: the bar of the system, with its own back button. */
export function IosHeader() {
	const palette = usePalette();
	return (
		<Stack.Screen
			options={{
				headerShown: true,
				title: "",
				headerBackTitle: "Server",
				headerShadowVisible: false,
				headerStyle: { backgroundColor: String(palette.background) },
			}}
		/>
	);
}

function CardTitle({
	icon,
	children,
}: {
	icon: "browser" | "key";
	children: string;
}) {
	const palette = usePalette();
	return (
		<View style={{ flexDirection: "row", gap: SPACE.m, alignItems: "center" }}>
			<Icon name={icon} color={palette.primary} />
			<Text variant="titleMedium">{children}</Text>
		</View>
	);
}

const BROWSER_NOTE =
	"Sign in on the server's own page, with any method it offers.";

/** The device flow in the browser. */
export function BrowserCard({
	hasMethods,
	busy,
	onPress,
}: {
	hasMethods: boolean;
	busy: boolean;
	onPress: () => void;
}) {
	const palette = usePalette();
	const variant = hasMethods ? "outlined" : "filled";
	if (IOS) {
		return (
			<View style={{ gap: SPACE.s }}>
				<ActionButton
					wide
					label="Sign in with the browser"
					variant={variant}
					onPress={onPress}
					disabled={busy}
				/>
				<GroupCaption>{BROWSER_NOTE}</GroupCaption>
			</View>
		);
	}
	return (
		<Card>
			<CardTitle icon="browser">Sign in with the browser</CardTitle>
			<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
				{BROWSER_NOTE}
			</Text>
			<ActionButton
				label="Sign in with the browser"
				variant={variant}
				onPress={onPress}
				disabled={busy}
			/>
		</Card>
	);
}

/** An API token from Preferences. */
export function TokenCard({ flow }: { flow: SignInFlow }) {
	const field = (
		<Field
			label="API token"
			hint="Make one in Farmer on the web, in Preferences, API tokens."
			value={flow.token}
			onChangeText={flow.setToken}
			placeholder="fmr_..."
			autoCapitalize="none"
			autoCorrect={false}
			secureTextEntry
			editable={!flow.busy}
			onSubmitEditing={() => void flow.withToken()}
		/>
	);
	const button = (
		<ActionButton
			wide={IOS}
			label="Sign in with the token"
			variant="outlined"
			onPress={() => void flow.withToken()}
			disabled={flow.busy || !flow.token.trim()}
		/>
	);
	if (IOS) {
		return (
			<View style={{ gap: SPACE.m }}>
				{field}
				{button}
			</View>
		);
	}
	return (
		<Card>
			<CardTitle icon="key">Use an API token</CardTitle>
			{field}
			{button}
		</Card>
	);
}

/** The code to check while the person approves in the browser. */
export function WaitingCard({
	code,
	onCancel,
}: {
	code: DeviceCode;
	onCancel: () => void;
}) {
	const palette = usePalette();
	return (
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
				<ActionButton label="Cancel" variant="text" onPress={onCancel} />
			</View>
		</Card>
	);
}

/** The email and password form. */
export function PasswordSection({
	flow,
	hasProviders,
}: {
	flow: SignInFlow;
	hasProviders: boolean;
}) {
	const emailField = (
		<Field
			label="Email"
			value={flow.email}
			onChangeText={flow.setEmail}
			placeholder="you@example.com"
			keyboardType="email-address"
			autoCapitalize="none"
			autoCorrect={false}
			autoComplete="email"
			textContentType="username"
			returnKeyType="next"
			editable={!flow.busy}
		/>
	);
	const passwordField = (
		<Field
			label="Password"
			value={flow.password}
			onChangeText={flow.setPassword}
			secureTextEntry
			autoCapitalize="none"
			autoCorrect={false}
			autoComplete="current-password"
			textContentType="password"
			returnKeyType="go"
			onSubmitEditing={() => void flow.withPassword()}
			editable={!flow.busy}
		/>
	);
	const button = (
		<ActionButton
			wide
			label="Sign in"
			variant={hasProviders ? "outlined" : "filled"}
			onPress={() => void flow.withPassword()}
			disabled={flow.busy || !flow.email.trim() || !flow.password}
		/>
	);
	if (IOS) {
		return (
			<View style={{ gap: SPACE.m }}>
				<FormGroup>
					{emailField}
					{passwordField}
				</FormGroup>
				{button}
			</View>
		);
	}
	return (
		<Card>
			{emailField}
			{passwordField}
			{button}
		</Card>
	);
}

/** One button for each provider that the server lists. */
export function ProviderButtons({
	providers,
	busy,
	onPick,
}: {
	providers: SignInMethod[];
	busy: boolean;
	onPick: (method: SignInMethod) => void;
}) {
	return (
		<View style={{ gap: SPACE.s }}>
			{providers.map((method) => (
				<ActionButton
					key={method.id}
					label={`Continue with ${method.name}`}
					wide
					onPress={() => onPick(method)}
					disabled={busy}
				/>
			))}
		</View>
	);
}

/** The switch that shows the other ways to sign in. */
export function OthersToggle({
	shown,
	onToggle,
}: {
	shown: boolean;
	onToggle: () => void;
}) {
	return (
		<View style={{ flexDirection: "row", paddingTop: SPACE.s }}>
			<ActionButton
				label={
					shown ? "Hide the other ways to sign in" : "Other ways to sign in"
				}
				variant="text"
				wide
				onPress={onToggle}
			/>
		</View>
	);
}

export function Busy() {
	const palette = usePalette();
	return (
		<View style={{ alignItems: "center" }}>
			<LoadingIndicator size={24} color={palette.primary} />
		</View>
	);
}

export function Pending() {
	const palette = usePalette();
	return (
		<View style={{ paddingVertical: SPACE.xl, alignItems: "center" }}>
			<LoadingIndicator size={32} color={palette.primary} />
		</View>
	);
}
