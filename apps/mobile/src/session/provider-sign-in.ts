import { expoClient } from "@better-auth/expo/client";
import type { SignInMethod } from "@farmer/api-client";
import { createAuthClient } from "better-auth/client";
import {
	CryptoDigestAlgorithm,
	digest,
	getRandomBytes,
	randomUUID,
} from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { z } from "zod";

import { USER_AGENT } from "../config";
import {
	base64UrlFromBytes,
	callbackUrlFor,
	FlowKeeper,
	proxyUrlFor,
	redirectPrefixFor,
} from "./auth-flow";

/**
 * The sign-in through `@better-auth/expo` (ADR 0005): one button for each
 * method in `/meta`, and the email and password form when the server offers
 * it. The result is a session token that the app sends as a bearer to
 * `/api/v1`, never as a cookie.
 *
 * The expo client starts each request: it adds `expo-origin: farmer://`,
 * omits the cookies of the system and keeps the answer's cookies in the
 * secure store. With a server that has the exchange, the link carries a
 * one-time code and the app redeems it with its verifier (`auth-flow.ts`).
 * The app opens the browser leg itself (`disableRedirect`),
 * because the client's own leg stores the cookie of any callback and gives
 * the app no way to check the nonce of the flow first.
 */

/** The one active provider flow of the app. */
export const flows = new FlowKeeper();

/** A small, stable hash of the server address, for the storage keys. A
 *  secure-store key allows only letters, digits, ".", "-" and "_". */
const keyFor = (origin: string) => {
	let hash = 5381;
	for (const char of origin) {
		hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
	}
	return `farmer-auth-${hash.toString(36)}`;
};

const makeClient = (origin: string) => {
	const storagePrefix = keyFor(origin);
	return {
		storagePrefix,
		auth: createAuthClient({
			baseURL: `${origin}/api/auth`,
			// The server records this as the name of the device that signs in,
			// in Preferences → Signed-in devices. Else it reads "okhttp".
			fetchOptions: { headers: { "user-agent": USER_AGENT } },
			plugins: [
				expoClient({
					scheme: "farmer",
					storagePrefix,
					storage: SecureStore,
					// The app reads the session through `/api/v1`, not through
					// better-auth's `get-session`.
					disableCache: true,
				}),
			],
		}),
	};
};

/** One client for each server: the base URL and the stored cookies belong
 *  to the server. */
const clients = new Map<string, ReturnType<typeof makeClient>>();
const clientFor = (origin: string) => {
	const existing = clients.get(origin);
	if (existing) return existing;
	const created = makeClient(origin);
	clients.set(origin, created);
	return created;
};

/** The app keeps the bearer in its own session store. The better-auth cookie
 *  is a second copy of the same secret, so it goes after each attempt. */
const forgetCookies = async (origin: string) => {
	const { storagePrefix } = clientFor(origin);
	await SecureStore.deleteItemAsync(`${storagePrefix}_cookie`).catch(
		() => undefined,
	);
};

const startAnswer = z.object({ url: z.string() });
const emailAnswer = z.object({ token: z.string().min(1) });

/** A failed request of the auth client: its status, code and message. */
const authError = z.object({
	status: z.number().optional(),
	code: z.string().optional(),
	message: z.string().optional(),
});

export type SignInOutcome =
	| { kind: "token"; token: string }
	| { kind: "cancelled" }
	| { kind: "error"; message: string };

const START_FAILED =
	"The server did not start the sign-in. Try again, or use another way to sign in.";

/** A new verifier (32 random bytes, 43 characters) and its S256 challenge. */
const makeVerifier = async () => {
	const verifier = base64UrlFromBytes(getRandomBytes(32));
	const hash = await digest(
		CryptoDigestAlgorithm.SHA256,
		new TextEncoder().encode(verifier),
	);
	return { verifier, challenge: base64UrlFromBytes(new Uint8Array(hash)) };
};

/** Turns the code of a callback into the session token. The server answers
 *  every refusal the same way, so the app has one message for them. */
const redeemCode = async (
	origin: string,
	code: string,
	verifier: string,
): Promise<SignInOutcome> => {
	const { auth } = clientFor(origin);
	const response = await auth.$fetch("/mobile/exchange", {
		method: "POST",
		body: { code, verifier },
	});
	const answer = emailAnswer.safeParse(response.data);
	if (answer.success) return { kind: "token", token: answer.data.token };
	return { kind: "error", message: START_FAILED };
};

/**
 * Signs in with a provider: the server's start, the provider's page and the
 * server's confirmation page in the system auth session, and the link back,
 * checked against the flow's nonce. The auth session waits for the first
 * `farmer://` link and does not care how many pages come before it. The link
 * carries a one-time code. The app redeems the code with the verifier that
 * made the challenge in the `callbackURL`.
 */
export const signInWithProvider = async (
	origin: string,
	method: SignInMethod,
): Promise<SignInOutcome> => {
	const { auth } = clientFor(origin);
	const secret = await makeVerifier();
	const flow = flows.start(origin, randomUUID(), Date.now(), secret.verifier);
	const callbackURL = callbackUrlFor(flow, secret.challenge);
	try {
		const body = {
			callbackURL,
			errorCallbackURL: callbackURL,
			newUserCallbackURL: callbackURL,
			disableRedirect: true,
		};
		const started =
			method.kind === "social"
				? await auth.$fetch("/sign-in/social", {
						method: "POST",
						body: { ...body, provider: method.id },
					})
				: await auth.$fetch("/sign-in/oauth2", {
						method: "POST",
						body: { ...body, providerId: method.id },
					});
		const answer = startAnswer.safeParse(started.data);
		if (!answer.success) return { kind: "error", message: START_FAILED };

		// An auth session that is still open on Android makes the next one
		// fail. The expo client closes it the same way.
		if (Platform.OS === "android") {
			try {
				WebBrowser.dismissAuthSession();
			} catch {
				// Nothing was open.
			}
		}
		const proxy = proxyUrlFor(origin, answer.data.url);
		// The link that answers carries `code`, not `cc`, so the callback URL is
		// not its prefix. The nonce prefix is (see `redirectPrefixFor`).
		const result = await WebBrowser.openAuthSessionAsync(
			proxy,
			redirectPrefixFor(flow),
		);
		if (result.type !== "success") return { kind: "cancelled" };

		const read = flows.finish(result.url, Date.now());
		if (read.kind === "code") {
			return await redeemCode(origin, read.code, flow.verifier);
		}
		if (read.kind === "error") return read;
		return { kind: "error", message: START_FAILED };
	} catch {
		return { kind: "error", message: START_FAILED };
	} finally {
		flows.cancel(flow);
		await forgetCookies(origin);
	}
};

const PASSWORD_TEXT = new Map(
	Object.entries({
		INVALID_EMAIL_OR_PASSWORD: "The email or the password is not correct.",
		INVALID_EMAIL: "Enter a valid email address.",
		EMAIL_NOT_VERIFIED: "Confirm your email address first.",
	}),
);

/** Signs in with an email and a password, through better-auth's
 *  `/sign-in/email`. Only for a server whose `/meta` offers it. */
export const signInWithPassword = async (
	origin: string,
	email: string,
	password: string,
): Promise<SignInOutcome> => {
	const { auth } = clientFor(origin);
	try {
		const response = await auth.$fetch("/sign-in/email", {
			method: "POST",
			body: { email, password },
		});
		const answer = emailAnswer.safeParse(response.data);
		if (answer.success) return { kind: "token", token: answer.data.token };
		const error = authError.safeParse(response.error);
		const code = error.success ? error.data.code : undefined;
		const known = code ? PASSWORD_TEXT.get(code) : undefined;
		if (known) return { kind: "error", message: known };
		// This text comes from the server the person chose, not from a link.
		const message = error.success ? error.data.message : undefined;
		return {
			kind: "error",
			message: message ?? "The sign-in did not complete. Try again.",
		};
	} catch {
		return {
			kind: "error",
			message: `Could not reach ${origin}. Check the connection.`,
		};
	} finally {
		await forgetCookies(origin);
	}
};
