/**
 * The rules of the provider sign-in (ADR 0005), with no React and no native
 * module, so `bun test` reads them directly.
 *
 * The answer travels back to the app in a `farmer://auth-callback` deep
 * link. Another app, or a web page, can open such a link too, and another
 * app can claim the same scheme. Two rules close this:
 *
 * - The app keeps a nonce for the one flow it started, puts it in the
 *   callback URL, and refuses a callback without an active flow or with
 *   another nonce. This stops a forced sign-in into somebody else's account.
 * - The server puts a one-time code in the link, never the session. The app
 *   made a random verifier before the browser opened and sent only its S256
 *   challenge (`cc`). The code works only with the verifier, which never
 *   leaves the app until the exchange request. A hostile app that reads the
 *   link has the code and the challenge, and cannot redeem the code.
 *
 * The app reads a code and nothing else. A session in the link is not an
 * answer to the flow.
 */

export const AUTH_CALLBACK = "farmer://auth-callback";

/** The query parameter that carries the nonce of the flow. */
const FLOW_PARAM = "flow";

/** The query parameter that carries the S256 challenge of the verifier. */
const CHALLENGE_PARAM = "cc";

/** A flow that waits longer than this is over. The server keeps its OAuth
 *  state for ten minutes, so a later callback cannot succeed anyway. */
export const FLOW_LIFETIME_MS = 10 * 60_000;

export type ActiveFlow = {
	nonce: string;
	/** The server that the flow signs in to. */
	origin: string;
	startedAt: number;
	/** The secret of the flow. It is sent once, to the exchange endpoint. */
	verifier: string;
};

/** Bytes as base64url with no padding, the encoding of RFC 7636. */
export const base64UrlFromBytes = (bytes: Uint8Array): string => {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i] ?? 0;
		const b = bytes[i + 1] ?? 0;
		const c = bytes[i + 2] ?? 0;
		const triple = (a << 16) | (b << 8) | c;
		out += alphabet.charAt((triple >> 18) & 63);
		out += alphabet.charAt((triple >> 12) & 63);
		if (i + 1 < bytes.length) out += alphabet.charAt((triple >> 6) & 63);
		if (i + 2 < bytes.length) out += alphabet.charAt(triple & 63);
	}
	return out;
};

/** The S256 challenge of a verifier: base64url of its SHA-256. `sha256` is
 *  the platform's hash of the verifier's UTF-8 bytes. */
export const challengeFor = (
	verifier: string,
	sha256: (text: string) => Uint8Array,
): string => base64UrlFromBytes(sha256(verifier));

/** The start of every link that answers the flow: the callback with the
 *  nonce. The server removes `cc` and adds `code` after the nonce, so the
 *  answer starts with this text and the `callbackURL` is not a prefix of it.
 *  The auth session of the browser module compares the link with this prefix
 *  (`startsWith`). */
export const redirectPrefixFor = (flow: ActiveFlow) =>
	`${AUTH_CALLBACK}?${FLOW_PARAM}=${encodeURIComponent(flow.nonce)}`;

/** The `callbackURL` (and `errorCallbackURL`) of a flow. `challenge` is the
 *  S256 challenge of the flow's verifier. */
export const callbackUrlFor = (flow: ActiveFlow, challenge: string) =>
	`${redirectPrefixFor(flow)}&${CHALLENGE_PARAM}=${encodeURIComponent(challenge)}`;

/**
 * The address that the system browser opens first. The server's proxy
 * accepts only the exact `authorizationURL` that the sign-in start made.
 */
export const proxyUrlFor = (origin: string, authorizationURL: string) =>
	`${origin}/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL })}`;

export type CallbackResult =
	/** The one-time code of the flow. The app sends it, with the flow's
	 *  verifier, to the exchange endpoint. */
	| { kind: "code"; code: string }
	/** The provider or the server refused. `message` is app text. */
	| { kind: "error"; message: string }
	/** The link is not the answer to the active flow. Ignore it. */
	| { kind: "refused"; reason: "no_flow" | "not_callback" | "wrong_flow" };

const GENERIC_ERROR =
	"The sign-in did not complete. Try again, or use another way to sign in.";

const CLOSED =
	"This server does not accept new accounts. Ask an administrator to invite you, then sign in with the address of the invitation.";

const INVITE_ONLY =
	"This workspace is invite-only. Sign in with the account that the invitation went to, or ask an administrator to invite you.";

const EXPIRED = "The sign-in expired. Start it again.";

/**
 * Known values of the link's `error` parameter, as app text. The value comes
 * from a URL that anybody can write, so the app never shows it. A refusal of
 * the registration gate arrives as its message with "_" for each space
 * (genericOAuth) or as its code (the social callback), so both are here.
 */
const ERROR_TEXT: [match: (code: string) => boolean, text: string][] = [
	[(code) => code === "access_denied", "You cancelled the sign-in."],
	[
		(code) =>
			code === "REGISTRATION_CLOSED" ||
			code === "signup_disabled" ||
			code.startsWith("This_instance_does_not_accept"),
		CLOSED,
	],
	[
		(code) => code === "INVITE_ONLY" || code.startsWith("This_workspace_is"),
		INVITE_ONLY,
	],
	[
		(code) =>
			code === "state_mismatch" ||
			code === "state_not_found" ||
			code === "please_restart_the_process" ||
			code === "invalid_callback_request" ||
			code === "no_code",
		EXPIRED,
	],
	[
		(code) => code === "account_not_linked",
		"An account with this email exists, and this sign-in method is not linked to it. Sign in the way you did before.",
	],
	[
		(code) => code === "email_not_found" || code === "email_is_missing",
		"The provider did not give an email address. Farmer needs one to sign you in.",
	],
	[
		(code) => code === "banned" || code === "user_banned",
		"This account is blocked on this server.",
	],
];

/** App text for the `error` of a callback, or the generic sentence. */
export const errorTextFor = (code: string): string =>
	ERROR_TEXT.find(([match]) => match(code))?.[1] ?? GENERIC_ERROR;

/**
 * Reads a `farmer://auth-callback` link against the active flow. A link is
 * refused when no flow is active, when it is for another flow, and when the
 * flow is older than `FLOW_LIFETIME_MS`.
 */
export const readCallback = (
	url: string,
	flow: ActiveFlow | null,
	now: number,
): CallbackResult => {
	if (!flow || now - flow.startedAt > FLOW_LIFETIME_MS) {
		return { kind: "refused", reason: "no_flow" };
	}
	// Read by hand, not with `URL`: React Native's `URL` is not the one of a
	// browser (see `normalizeOrigin`), and only the query is needed.
	const withoutFragment = url.split("#")[0] ?? "";
	if (!withoutFragment.startsWith(`${AUTH_CALLBACK}?`)) {
		return { kind: "refused", reason: "not_callback" };
	}
	const params = new URLSearchParams(
		withoutFragment.slice(AUTH_CALLBACK.length + 1),
	);
	if (params.get(FLOW_PARAM) !== flow.nonce) {
		return { kind: "refused", reason: "wrong_flow" };
	}
	const error = params.get("error");
	if (error) return { kind: "error", message: errorTextFor(error) };
	// A code and nothing else: a session in the link is not an answer.
	const code = params.get("code");
	if (!code) return { kind: "error", message: GENERIC_ERROR };
	return { kind: "code", code };
};

/**
 * The one active flow of the app. A new flow replaces the old one, so the
 * callback of a flow that the person gave up on is refused.
 */
export class FlowKeeper {
	#active: ActiveFlow | null = null;

	start(
		origin: string,
		nonce: string,
		now: number,
		verifier: string,
	): ActiveFlow {
		this.#active = { nonce, origin, startedAt: now, verifier };
		return this.#active;
	}

	get active(): ActiveFlow | null {
		return this.#active;
	}

	/** Reads a callback, and ends the flow when the link was its answer. */
	finish(url: string, now: number): CallbackResult {
		const result = readCallback(url, this.#active, now);
		if (result.kind !== "refused") this.#active = null;
		return result;
	}

	/** Ends the flow, if it is still `flow`. */
	cancel(flow: ActiveFlow) {
		if (this.#active === flow) this.#active = null;
	}
}
