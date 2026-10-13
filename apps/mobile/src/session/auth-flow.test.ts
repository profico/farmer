import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
	type ActiveFlow,
	base64UrlFromBytes,
	challengeFor,
	callbackUrlFor,
	errorTextFor,
	FLOW_LIFETIME_MS,
	FlowKeeper,
	proxyUrlFor,
	readCallback,
	redirectPrefixFor,
} from "./auth-flow";

const NOW = 1_800_000_000_000;
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const flow: ActiveFlow = {
	nonce: "n-123",
	origin: "https://farmer.example.com",
	startedAt: NOW,
	verifier: VERIFIER,
};

/** A session cookie as `expo()` writes it into the link. The server must
 *  never leave it there. */
const SET_COOKIE =
	"better-auth.session_token=tok123.c2lnbmF0dXJl%3D; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax";

/** The link as the server writes it: the callback URL of the flow, with the
 *  code added by `URLSearchParams.set`. */
const linkFor = (callback: string, extra: Record<string, string>) => {
	const [base = "", query = ""] = callback.split("?");
	const params = new URLSearchParams(query);
	for (const [key, value] of Object.entries(extra)) params.set(key, value);
	return `${base}?${params}`;
};

describe("readCallback", () => {
	const callback = callbackUrlFor(flow, "the-challenge");

	test("gives the code of a callback for the active flow", () => {
		const link = linkFor(callback, { code: "one-time" });
		expect(readCallback(link, flow, NOW + 1000)).toEqual({
			kind: "code",
			code: "one-time",
		});
	});

	test("refuses any callback when no flow is active", () => {
		const link = linkFor(callback, { code: "one-time" });
		expect(readCallback(link, null, NOW)).toEqual({
			kind: "refused",
			reason: "no_flow",
		});
	});

	test("refuses a callback without the nonce, or with another one", () => {
		const bare = `farmer://auth-callback?${new URLSearchParams({ code: "x" })}`;
		expect(readCallback(bare, flow, NOW)).toEqual({
			kind: "refused",
			reason: "wrong_flow",
		});
		const other = linkFor("farmer://auth-callback?flow=n-999", { code: "x" });
		expect(readCallback(other, flow, NOW)).toEqual({
			kind: "refused",
			reason: "wrong_flow",
		});
	});

	test("refuses a callback after the flow expired", () => {
		const link = linkFor(callback, { code: "one-time" });
		expect(readCallback(link, flow, NOW + FLOW_LIFETIME_MS + 1)).toEqual({
			kind: "refused",
			reason: "no_flow",
		});
	});

	test("refuses a link that is not the sign-in callback", () => {
		for (const link of [
			`farmer://connect?flow=n-123&code=x`,
			`https://evil.example/auth-callback?flow=n-123`,
			`farmer://auth-callbackx?flow=n-123`,
			"not a link",
		]) {
			expect(readCallback(link, flow, NOW)).toEqual({
				kind: "refused",
				reason: "not_callback",
			});
		}
	});

	test("never shows the text of the link's error", () => {
		const link = linkFor(callback, {
			error: "Call_this_number_to_restore_your_account",
		});
		const result = readCallback(link, flow, NOW);
		expect(result.kind).toBe("error");
		if (result.kind !== "error") return;
		expect(result.message).not.toContain("number");
		expect(result.message).toBe(errorTextFor("anything-unknown"));
	});

	test("maps a known refusal to the app's own text", () => {
		const link = linkFor(callback, {
			error: "This_instance_does_not_accept_new_accounts._Ask_an_administrator",
		});
		const result = readCallback(link, flow, NOW);
		expect(result).toEqual({
			kind: "error",
			message: errorTextFor("REGISTRATION_CLOSED"),
		});
		expect(errorTextFor("access_denied")).toBe("You cancelled the sign-in.");
	});

	test("does not take a session from the link", () => {
		const link = linkFor(callback, { cookie: SET_COOKIE });
		expect(readCallback(link, flow, NOW).kind).toBe("error");
	});

	test("the error of exchange_failed is the generic text", () => {
		const link = linkFor(callback, { error: "exchange_failed" });
		expect(readCallback(link, flow, NOW)).toEqual({
			kind: "error",
			message: errorTextFor("exchange_failed"),
		});
	});

	test("a refusal in the link is an error, even with a code", () => {
		const link = linkFor(callback, { error: "access_denied", code: "x" });
		expect(readCallback(link, flow, NOW)).toEqual({
			kind: "error",
			message: errorTextFor("access_denied"),
		});
	});
});

describe("FlowKeeper", () => {
	test("ends the flow on its callback, so the link works once", () => {
		const keeper = new FlowKeeper();
		const started = keeper.start("https://a.example", "nonce-1", NOW, VERIFIER);
		const link = linkFor(callbackUrlFor(started, "c"), { code: "one-time" });
		expect(keeper.finish(link, NOW).kind).toBe("code");
		expect(keeper.active).toBeNull();
		expect(keeper.finish(link, NOW)).toEqual({
			kind: "refused",
			reason: "no_flow",
		});
	});

	test("keeps the flow when a stray link arrives", () => {
		const keeper = new FlowKeeper();
		const started = keeper.start("https://a.example", "nonce-1", NOW, VERIFIER);
		const stray = linkFor("farmer://auth-callback?flow=other", {
			code: "one-time",
		});
		expect(keeper.finish(stray, NOW).kind).toBe("refused");
		expect(keeper.active).toBe(started);
	});

	test("a new flow replaces the old one, and its callback is refused", () => {
		const keeper = new FlowKeeper();
		const first = keeper.start("https://a.example", "nonce-1", NOW, VERIFIER);
		keeper.start("https://a.example", "nonce-2", NOW, VERIFIER);
		const late = linkFor(callbackUrlFor(first, "c"), { code: "one-time" });
		expect(keeper.finish(late, NOW)).toEqual({
			kind: "refused",
			reason: "wrong_flow",
		});
	});

	test("cancel ends only the flow it names", () => {
		const keeper = new FlowKeeper();
		const first = keeper.start("https://a.example", "nonce-1", NOW, VERIFIER);
		const second = keeper.start("https://a.example", "nonce-2", NOW, VERIFIER);
		keeper.cancel(first);
		expect(keeper.active).toBe(second);
		keeper.cancel(second);
		expect(keeper.active).toBeNull();
	});
});

describe("the exchange flow", () => {
	const verifier = VERIFIER;
	const callback = callbackUrlFor(flow, "the-challenge");

	test("makes the S256 challenge of RFC 7636 appendix B", () => {
		const sha256 = (text: string) =>
			new Uint8Array(createHash("sha256").update(text).digest());
		expect(challengeFor(verifier, sha256)).toBe(
			"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		);
	});

	test("encodes bytes as base64url with no padding", () => {
		expect(base64UrlFromBytes(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe("-__-");
		expect(base64UrlFromBytes(new Uint8Array([1]))).toBe("AQ");
		expect(base64UrlFromBytes(new Uint8Array([1, 2]))).toBe("AQI");
	});

	test("puts the challenge in the callback URL, never the verifier", () => {
		expect(callback).toBe("farmer://auth-callback?flow=n-123&cc=the-challenge");
		expect(callback).not.toContain(verifier);
	});
});

describe("the redirect prefix", () => {
	/** What the server does to the link (`mobile-exchange.ts`): `cookie` and
	 *  `cc` out, `code` in. `URL` keeps the order of the other parameters. */
	const answerFor = (callback: string) => {
		const url = new URL(callback);
		url.searchParams.delete("cc");
		url.searchParams.set("code", "one-time");
		return url.toString();
	};

	test("starts the link that answers the flow", () => {
		const callback = callbackUrlFor(flow, "the-challenge");
		const answer = answerFor(callback);
		expect(answer.startsWith(redirectPrefixFor(flow))).toBe(true);
		// The bug this guards: the browser module waits for a link that starts
		// with the `callbackURL`, which holds `cc`, and the answer does not.
		expect(answer.startsWith(callback)).toBe(false);
	});

	test("is the start of the callback URL", () => {
		expect(callbackUrlFor(flow, "c").startsWith(redirectPrefixFor(flow))).toBe(
			true,
		);
	});
});

describe("proxyUrlFor", () => {
	test("carries the authorization URL and the token", () => {
		const url = new URL(
			proxyUrlFor(
				"https://farmer.example.com",
				"https://accounts.google.com/o/oauth2/v2/auth?state=s&client_id=c",
				"tok-1",
			),
		);
		expect(url.origin + url.pathname).toBe(
			"https://farmer.example.com/api/auth/expo-authorization-proxy",
		);
		expect(url.searchParams.get("token")).toBe("tok-1");
		expect(url.searchParams.get("authorizationURL")).toBe(
			"https://accounts.google.com/o/oauth2/v2/auth?state=s&client_id=c",
		);
	});
});
