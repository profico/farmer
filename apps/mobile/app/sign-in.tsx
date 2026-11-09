import { assertUsable, fetchMeta } from "@farmer/api-client";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { transportFor } from "../src/api/transport";
import { APP_VERSION } from "../src/config";
import { signInOrigin } from "../src/session/server-address";
import { isServerConfirmed } from "../src/session/server-confirmation";
import { type SignInFlow, useSignInFlow } from "../src/session/sign-in-flow";
import {
	BrowserCard,
	Busy,
	IOS,
	IosHeader,
	OthersToggle,
	PasswordSection,
	Pending,
	ProviderButtons,
	TokenCard,
	WaitingCard,
} from "../src/session/sign-in-parts";
import { needsAppUpdate, UpdateAppButton } from "../src/session/update-app";
import { FarmerMark } from "../src/ui/brand";
import {
	ActionButton,
	ErrorBanner,
	IconButton,
	Text,
} from "../src/ui/components";
import { Inset, Screen } from "../src/ui/screen";
import { usePalette } from "../src/ui/theme";
import { SPACE } from "../src/ui/type";

type Meta = UseQueryResult<Awaited<ReturnType<typeof fetchMeta>>>;

/**
 * Sign-in. The server lists its methods in `/meta`: one button for each
 * provider, and the email and password form when it offers one (ADR 0005).
 * Two fallbacks stay for every server: the device flow in the browser, as
 * `farmer login` does, and an API token from Preferences.
 */
export default function SignInScreen() {
	const params = useLocalSearchParams<{ server?: string }>();
	// A deep link can set the parameter too. It must be an address that the
	// person confirmed on the Server screen, and then it gets that screen's
	// checks: `/meta` with `assertUsable`. Any other address goes back to the
	// Server screen, where the person taps Continue.
	const requested = signInOrigin(params.server);
	const server = isServerConfirmed(requested) ? requested : null;
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

	if (!server) {
		return params.server ? (
			<Redirect
				href={{ pathname: "/server", params: { server: params.server } }}
			/>
		) : (
			<Redirect href="/server" />
		);
	}
	return <SignInForm server={server} meta={meta} />;
}

function MetaFailure({ error, server }: { error: Error; server: string }) {
	const router = useRouter();
	return (
		<>
			<ErrorBanner message={error.message} />
			{needsAppUpdate(error) ? <UpdateAppButton /> : null}
			<ActionButton
				label="Change the server"
				onPress={() =>
					router.replace({ pathname: "/server", params: { server } })
				}
			/>
		</>
	);
}

function Heading({ server }: { server: string }) {
	const palette = usePalette();
	return (
		<View style={{ gap: SPACE.xs }}>
			<FarmerMark size={48} />
			<Text variant="headlineMedium">Sign in</Text>
			<Text variant="bodyLarge" color={palette.onSurfaceVariant}>
				{server}
			</Text>
		</View>
	);
}

function BackRow() {
	const router = useRouter();
	return (
		<View style={{ flexDirection: "row", alignItems: "center" }}>
			<IconButton
				icon="back"
				label="Change the server"
				onPress={() => router.back()}
			/>
		</View>
	);
}

/** The two ways that every server has. */
function Fallbacks({
	flow,
	hasMethods,
}: {
	flow: SignInFlow;
	hasMethods: boolean;
}) {
	return (
		<>
			<BrowserCard
				hasMethods={hasMethods}
				running={flow.running}
				onPress={() => void flow.withBrowser()}
			/>
			<TokenCard flow={flow} />
		</>
	);
}

/** The methods that the server lists, and the other ways behind a switch. */
function Methods({
	flow,
	meta,
	showOthers,
	onToggle,
}: {
	flow: SignInFlow;
	meta: Meta;
	showOthers: boolean;
	onToggle: () => void;
}) {
	const providers = meta.data?.signInMethods ?? [];
	return (
		<>
			{providers.length > 0 ? (
				<ProviderButtons
					providers={providers}
					running={flow.running}
					onPick={(method) => void flow.withProvider(method)}
				/>
			) : null}
			{meta.data?.passwordSignIn === true ? (
				<PasswordSection flow={flow} hasProviders={providers.length > 0} />
			) : null}
			{/* Android draws the spinner in the button that runs. */}
			{flow.busy && IOS ? <Busy /> : null}
			<OthersToggle shown={showOthers} busy={flow.busy} onToggle={onToggle} />
			{showOthers ? <Fallbacks flow={flow} hasMethods /> : null}
		</>
	);
}

function Body({
	flow,
	meta,
	server,
	showOthers,
	onToggle,
}: {
	flow: SignInFlow;
	meta: Meta;
	server: string;
	showOthers: boolean;
	onToggle: () => void;
}) {
	if (meta.isPending) return <Pending />;
	if (meta.isError) {
		return <MetaFailure error={meta.error} server={server} />;
	}
	if (flow.code) return <WaitingCard code={flow.code} onCancel={flow.cancel} />;
	const hasMethods =
		(meta.data?.signInMethods ?? []).length > 0 ||
		meta.data?.passwordSignIn === true;
	if (!hasMethods) return <Fallbacks flow={flow} hasMethods={false} />;
	return (
		<Methods
			flow={flow}
			meta={meta}
			showOthers={showOthers}
			onToggle={onToggle}
		/>
	);
}

function SignInForm({ server, meta }: { server: string; meta: Meta }) {
	const flow = useSignInFlow(server);
	const [showOthers, setShowOthers] = useState(false);
	return (
		<Screen topInset={!IOS} keyboardInsets>
			{IOS ? <IosHeader /> : null}
			<Inset>
				{IOS ? null : <BackRow />}
				<Heading server={server} />
				{flow.error ? <ErrorBanner message={flow.error} /> : null}
				<Body
					flow={flow}
					meta={meta}
					server={server}
					showOthers={showOthers}
					onToggle={() => setShowOthers((shown) => !shown)}
				/>
			</Inset>
		</Screen>
	);
}
