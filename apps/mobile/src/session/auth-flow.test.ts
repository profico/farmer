import { describe, expect, test } from "bun:test";

import {
	type ActiveFlow,
	callbackUrlFor,
	errorTextFor,
	FLOW_LIFETIME_MS,
	FlowKeeper,
	readCallback,
	sessionTokenFrom,
} from "./auth-flow";

const NOW = 1_800_000_000_000;
const flow: ActiveFlow = {
	nonce: "n-123",
	origin: "https://farmer.example.com",
	startedAt: NOW,
};

/** The `Set-Cookie` header that the server's expo plugin puts in the link. */
const SET_COOKIE =
	"better-auth.session_token=tok123.c2lnbmF0dXJl%3D; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax, better-auth.state=; Max-Age=0; Path=/";

/** The link as the server writes it: the callback URL of the flow, with the
 *  cookie added by `URLSearchParams.set`. */
const linkFor = (callback: string, extra: Record<string, string>) => {
	const [base = "", query = ""] = callback.split("?");
	const params = new URLSearchParams(query);
	for (const [key, value] of Object.entries(extra)) params.set(key, value);
	return `${base}?${params}`;
};

describe("sessionTokenFrom", () => {
	test("takes the token part of the signed cookie", () => {
		expect(sessionTokenFrom(SET_COOKIE)).toBe("tok123");
	});

	test("reads the __Secure- cookie of an https server", () => {
		expect(
			sessionTokenFrom(
				"__Secure-better-auth.session_token=abc.def%2B%3D; Path=/; Secure",
			),
		).toBe("abc");
	});

	test("gives nothing for a header without a session cookie", () => {
		expect(sessionTokenFrom("better-auth.state=; Max-Age=0; Path=/")).toBe("");
		expect(sessionTokenFrom("")).toBe("");
	});

	test("does not read a cookie whose name only ends the same way", () => {
		expect(sessionTokenFrom("evil-better-auth.session_token=x.y; Path=/")).toBe(
			"",
		);
	});
});

describe("readCallback", () => {
	const callback = callbackUrlFor(flow);

	test("gives the token of a callback for the active flow", () => {
		const link = linkFor(callback, { cookie: SET_COOKIE });
		expect(readCallback(link, flow, NOW + 1000)).toEqual({
			kind: "session",
			token: "tok123",
		});
	});

	test("refuses any callback when no flow is active", () => {
		const link = linkFor(callback, { cookie: SET_COOKIE });
		expect(readCallback(link, null, NOW)).toEqual({
			kind: "refused",
			reason: "no_flow",
		});
	});

	test("refuses a callback without the nonce, or with another one", () => {
		const bare = `farmer://auth-callback?${new URLSearchParams({ cookie: SET_COOKIE })}`;
		expect(readCallback(bare, flow, NOW)).toEqual({
			kind: "refused",
			reason: "wrong_flow",
		});
		const other = linkFor("farmer://auth-callback?flow=n-999", {
			cookie: SET_COOKIE,
		});
		expect(readCallback(other, flow, NOW)).toEqual({
			kind: "refused",
			reason: "wrong_flow",
		});
	});

	test("refuses a callback after the flow expired", () => {
		const link = linkFor(callback, { cookie: SET_COOKIE });
		expect(readCallback(link, flow, NOW + FLOW_LIFETIME_MS + 1)).toEqual({
			kind: "refused",
			reason: "no_flow",
		});
	});

	test("refuses a link that is not the sign-in callback", () => {
		for (const link of [
			`farmer://connect?flow=n-123&cookie=x`,
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

	test("a callback with no session cookie is an error, not a session", () => {
		const link = linkFor(callback, {
			cookie: "better-auth.state=; Max-Age=0; Path=/",
		});
		expect(readCallback(link, flow, NOW).kind).toBe("error");
	});
});

describe("FlowKeeper", () => {
	test("ends the flow on its callback, so the link works once", () => {
		const keeper = new FlowKeeper();
		const started = keeper.start("https://a.example", "nonce-1", NOW);
		const link = linkFor(callbackUrlFor(started), { cookie: SET_COOKIE });
		expect(keeper.finish(link, NOW).kind).toBe("session");
		expect(keeper.active).toBeNull();
		expect(keeper.finish(link, NOW)).toEqual({
			kind: "refused",
			reason: "no_flow",
		});
	});

	test("keeps the flow when a stray link arrives", () => {
		const keeper = new FlowKeeper();
		const started = keeper.start("https://a.example", "nonce-1", NOW);
		const stray = linkFor("farmer://auth-callback?flow=other", {
			cookie: SET_COOKIE,
		});
		expect(keeper.finish(stray, NOW).kind).toBe("refused");
		expect(keeper.active).toBe(started);
	});

	test("a new flow replaces the old one, and its callback is refused", () => {
		const keeper = new FlowKeeper();
		const first = keeper.start("https://a.example", "nonce-1", NOW);
		keeper.start("https://a.example", "nonce-2", NOW);
		const late = linkFor(callbackUrlFor(first), { cookie: SET_COOKIE });
		expect(keeper.finish(late, NOW)).toEqual({
			kind: "refused",
			reason: "wrong_flow",
		});
	});

	test("cancel ends only the flow it names", () => {
		const keeper = new FlowKeeper();
		const first = keeper.start("https://a.example", "nonce-1", NOW);
		const second = keeper.start("https://a.example", "nonce-2", NOW);
		keeper.cancel(first);
		expect(keeper.active).toBe(second);
		keeper.cancel(second);
		expect(keeper.active).toBeNull();
	});
});
