/**
 * The rules of the provider sign-in (ADR 0005), with no React and no native
 * module, so `bun test` reads them directly.
 *
 * The session travels back to the app in a `farmer://auth-callback` deep
 * link. Another app, or a web page, can open such a link too. So the app
 * keeps a nonce for the one flow it started, puts it in the callback URL,
 * and refuses a callback without an active flow or with another nonce. This
 * stops a forced sign-in into somebody else's account. It does not stop a
 * hostile app on the phone that claims the same scheme (see the ADR).
 */

export const AUTH_CALLBACK = "farmer://auth-callback";

/** The query parameter that carries the nonce of the flow. */
const FLOW_PARAM = "flow";

/** A flow that waits longer than this is over. The server keeps its OAuth
 *  state for ten minutes, so a later callback cannot succeed anyway. */
export const FLOW_LIFETIME_MS = 10 * 60_000;

export type ActiveFlow = {
	nonce: string;
	/** The server that the flow signs in to. */
	origin: string;
	startedAt: number;
};

/** The `callbackURL` (and `errorCallbackURL`) of a flow. */
export const callbackUrlFor = (flow: ActiveFlow) =>
	`${AUTH_CALLBACK}?${FLOW_PARAM}=${encodeURIComponent(flow.nonce)}`;

export type CallbackResult =
	/** The session token, ready to use as `Authorization: Bearer`. */
	| { kind: "session"; token: string }
	/** The provider or the server refused. `message` is app text. */
	| { kind: "error"; message: string }
	/** The link is not the answer to the active flow. Ignore it. */
	| { kind: "refused"; reason: "no_flow" | "not_callback" | "wrong_flow" };

const SESSION_COOKIE =
	/(?:^|[\s,;])(?:__Secure-)?better-auth\.session_token=([^;,\s]+)/;

/**
 * The session token in a `Set-Cookie` header. The cookie holds the signed
 * value `<token>.<signature>`, URL-encoded. `/api/v1` takes the token part
 * as a bearer. An empty string when the header has no session cookie, such
 * as the expired state cookie of a refused sign-in.
 */
export const sessionTokenFrom = (setCookie: string): string => {
	const match = SESSION_COOKIE.exec(setCookie);
	if (!match?.[1]) return "";
	let signed: string;
	try {
		signed = decodeURIComponent(match[1]);
	} catch {
		return "";
	}
	return signed.split(".")[0] ?? "";
};

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
	const token = sessionTokenFrom(params.get("cookie") ?? "");
	if (!token) return { kind: "error", message: GENERIC_ERROR };
	return { kind: "session", token };
};

/**
 * The one active flow of the app. A new flow replaces the old one, so the
 * callback of a flow that the person gave up on is refused.
 */
export class FlowKeeper {
	#active: ActiveFlow | null = null;

	start(origin: string, nonce: string, now: number): ActiveFlow {
		this.#active = { nonce, origin, startedAt: now };
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
