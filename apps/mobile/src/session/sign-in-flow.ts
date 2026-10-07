import {
	type DeviceCode,
	FarmerClient,
	pollForToken,
	requestDeviceCode,
	type SignInMethod,
} from "@farmer/api-client";
import * as WebBrowser from "expo-web-browser";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { transportFor } from "../api/transport";
import { API_TOKEN_PREFIX } from "./credential";
import {
	type SignInOutcome,
	signInWithPassword,
	signInWithProvider,
} from "./provider-sign-in";
import { useSession } from "./session";

export const openApproval = (url: string) =>
	WebBrowser.openBrowserAsync(url, {
		// Android: a Custom Tab in the app's own task, so Back returns here.
		createTask: false,
		showTitle: true,
	}).catch(() => undefined);

/** What the sign-in handlers read and set. `attempt` has a number for each
 *  attempt. A poll stops once a newer attempt, a cancel or leaving the screen
 *  changed it. */
type Flow = {
	server: string;
	signIn: (server: string, token: string) => Promise<void>;
	attempt: RefObject<number>;
	setCode: (code: DeviceCode | null) => void;
	setBusy: (busy: boolean) => void;
	setError: (message: string | null) => void;
};

/** Checks a token with `GET /me`, then keeps it. */
const finish = async (flow: Flow, candidate: string) => {
	await new FarmerClient(transportFor(flow.server), candidate).me();
	await flow.signIn(flow.server, candidate);
};

const fail = (flow: Flow, failure: Error) => {
	flow.attempt.current += 1;
	flow.setError(failure.message);
	flow.setCode(null);
	flow.setBusy(false);
};

/** Finish, and show a failure on the screen. */
const finishOrFail = async (flow: Flow, candidate: string) => {
	try {
		await finish(flow, candidate);
	} catch (failure) {
		fail(flow, failure instanceof Error ? failure : new Error(String(failure)));
	}
};

/** The end of a provider or a password sign-in. */
const settle = async (flow: Flow, outcome: SignInOutcome) => {
	if (outcome.kind === "cancelled") {
		flow.setBusy(false);
		return;
	}
	if (outcome.kind === "error") {
		flow.setError(outcome.message);
		flow.setBusy(false);
		return;
	}
	await finishOrFail(flow, outcome.token);
};

const withProvider = async (flow: Flow, method: SignInMethod) => {
	flow.setError(null);
	flow.setBusy(true);
	flow.attempt.current += 1;
	await settle(flow, await signInWithProvider(flow.server, method));
};

const withPassword = async (flow: Flow, email: string, password: string) => {
	flow.setError(null);
	if (!email.trim() || !password) {
		flow.setError("Enter your email and your password.");
		return;
	}
	flow.setBusy(true);
	flow.attempt.current += 1;
	await settle(
		flow,
		await signInWithPassword(flow.server, email.trim(), password),
	);
};

const withBrowser = async (flow: Flow) => {
	flow.setError(null);
	flow.setBusy(true);
	flow.attempt.current += 1;
	const mine = flow.attempt.current;
	const transport = transportFor(flow.server);
	try {
		const started = await requestDeviceCode(transport);
		flow.setCode(started);
		void openApproval(started.verificationUriComplete);
		// On Android the app's timers pause while the Custom Tab is in
		// front, so this poll runs again as soon as the person comes back.
		const approved = await pollForToken(transport, started, {
			now: Date.now,
			cancelled: () => flow.attempt.current !== mine,
		});
		if (!approved) return;
		if (Platform.OS === "ios") {
			await WebBrowser.dismissBrowser().catch(() => undefined);
		}
		await finish(flow, approved);
	} catch (failure) {
		if (flow.attempt.current !== mine) return;
		fail(flow, failure instanceof Error ? failure : new Error(String(failure)));
	}
};

const withToken = async (flow: Flow, token: string) => {
	const candidate = token.trim();
	flow.setError(null);
	if (!candidate.startsWith(API_TOKEN_PREFIX)) {
		flow.setError(`An API token starts with ${API_TOKEN_PREFIX}.`);
		return;
	}
	flow.setBusy(true);
	await finishOrFail(flow, candidate);
};

const cancel = (flow: Flow) => {
	flow.attempt.current += 1;
	flow.setCode(null);
	flow.setBusy(false);
};

/** The state of the sign-in screen, and the ways to sign in. */
export const useSignInFlow = (server: string) => {
	const { signIn } = useSession();
	const [code, setCode] = useState<DeviceCode | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [token, setToken] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const attempt = useRef(0);

	useEffect(
		() => () => {
			attempt.current += 1;
		},
		[],
	);

	const flow: Flow = {
		server,
		signIn,
		attempt,
		setCode,
		setBusy,
		setError,
	};
	return {
		code,
		busy,
		error,
		token,
		setToken,
		email,
		setEmail,
		password,
		setPassword,
		withProvider: (method: SignInMethod) => withProvider(flow, method),
		withPassword: () => withPassword(flow, email, password),
		withBrowser: () => withBrowser(flow),
		withToken: () => withToken(flow, token),
		cancel: () => cancel(flow),
	};
};

export type SignInFlow = ReturnType<typeof useSignInFlow>;
