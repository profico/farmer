// The confirmation page of the mobile sign-in (ADR 0005): the callback no
// longer sends the browser to the app, and only a POST from the same session
// with the page's one-time id makes the code.

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { z } from "zod";

import { db } from "../db";
import { session, user, verification } from "../db/schema/auth";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
import { createTestDb, present, type TestDb } from "../test/harness";
import { auth } from "./index";
import { confirmPage } from "./mobile-confirm";
import {
	challengeFor,
	CONFIRMATION_TTL_MS,
	redeemExchangeCode,
	startConfirmation,
} from "./mobile-exchange";
import { sessionCookieHeader } from "./session-cookie";

let harness: TestDb;

beforeAll(async () => {
	harness = await createTestDb();
});

afterAll(async () => {
	await harness.close();
});

const ORIGIN = "http://localhost:3000";
const CONFIRM_URL = `${ORIGIN}/api/auth/mobile/confirm`;
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const LINK = "farmer://auth-callback?flow=n-1";

const getPage = (id: string, cookie?: string) =>
	auth.handler(
		new Request(`${CONFIRM_URL}?${new URLSearchParams({ id })}`, {
			headers: cookie ? { cookie } : {},
		}),
	);

const postConfirm = (
	form: Record<string, string>,
	cookie?: string,
): Promise<Response> => {
	const headers = new Headers({
		"content-type": "application/x-www-form-urlencoded",
	});
	if (cookie) headers.set("cookie", cookie);
	return auth.handler(
		new Request(CONFIRM_URL, {
			method: "POST",
			headers,
			body: new URLSearchParams(form).toString(),
		}),
	);
};

const expectInvalid = async (response: Response) => {
	expect(response.status).toBe(400);
	expect(response.headers.get("location")).toBeNull();
	expect(await response.text()).toContain("This sign-in is not valid");
};

describe("the confirmation", () => {
	const TOKEN = "session-token-confirm";
	const OTHER_TOKEN = "session-token-other";

	beforeEach(async () => {
		await db.delete(verification);
		await db.delete(session);
		await db.delete(user);
		await db.insert(user).values({
			id: "u-confirm",
			name: "Member",
			email: "confirm@example.com",
			emailVerified: true,
		});
		const expiresAt = new Date(Date.now() + 86_400_000);
		await db.insert(session).values([
			{ id: "s-confirm", token: TOKEN, userId: "u-confirm", expiresAt },
			{ id: "s-other", token: OTHER_TOKEN, userId: "u-confirm", expiresAt },
		]);
	});

	const pending = () =>
		startConfirmation({
			challenge: challengeFor(VERIFIER),
			sessionId: "s-confirm",
			link: LINK,
		});

	test("the page names the account and the server, and confirms nothing", async () => {
		const id = await pending();
		const cookie = await sessionCookieHeader(TOKEN);
		for (let i = 0; i < 2; i++) {
			const response = await getPage(id, cookie);
			expect(response.status).toBe(200);
			const html = await response.text();
			expect(html).toContain("confirm@example.com");
			expect(html).toContain(ORIGIN);
			expect(html).toContain('method="post"');
			expect(html).not.toContain("<script");
			expect(response.headers.get("location")).toBeNull();
		}
		// Two GETs later, the POST still works: a GET spends nothing.
		const sent = await postConfirm({ id, action: "continue" }, cookie);
		expect(sent.status).toBe(302);
	});

	test("the page cannot be framed or cached", async () => {
		const id = await pending();
		const response = await getPage(id, await sessionCookieHeader(TOKEN));
		const csp = response.headers.get("content-security-policy") ?? "";
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).not.toContain("script-src");
		expect(csp).not.toContain("form-action");
		expect(response.headers.get("x-frame-options")).toBe("DENY");
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	test("the page is refused with no session or another session", async () => {
		const id = await pending();
		await expectInvalid(await getPage(id));
		await expectInvalid(
			await getPage(id, await sessionCookieHeader(OTHER_TOKEN)),
		);
	});

	test("continue sends the browser to the app with a code", async () => {
		const id = await pending();
		const sent = await postConfirm(
			{ id, action: "continue" },
			await sessionCookieHeader(TOKEN),
		);
		expect(sent.status).toBe(302);
		const location = new URL(present(sent.headers.get("location"), "location"));
		expect(location.toString().startsWith(LINK)).toBe(true);
		const code = present(location.searchParams.get("code"), "the code");
		expect(await redeemExchangeCode(code, VERIFIER)).toBe(TOKEN);
	});

	test("cancel sends no code and ends the session", async () => {
		const id = await pending();
		const sent = await postConfirm(
			{ id, action: "cancel" },
			await sessionCookieHeader(TOKEN),
		);
		expect(sent.status).toBe(302);
		const location = new URL(present(sent.headers.get("location"), "location"));
		expect(location.searchParams.get("error")).toBe("access_denied");
		expect(location.searchParams.has("code")).toBe(false);
		const left = await db.select().from(session);
		expect(left.map((row) => row.id)).toEqual(["s-other"]);
	});

	test("the POST is refused without the id", async () => {
		await pending();
		const cookie = await sessionCookieHeader(TOKEN);
		const missing = await postConfirm({ action: "continue" }, cookie);
		expect(missing.status).toBe(400);
		expect(missing.headers.get("location")).toBeNull();
		await expectInvalid(
			await postConfirm({ id: "forged", action: "continue" }, cookie),
		);
	});

	test("an id works once", async () => {
		const id = await pending();
		const cookie = await sessionCookieHeader(TOKEN);
		expect((await postConfirm({ id, action: "continue" }, cookie)).status).toBe(
			302,
		);
		await expectInvalid(await postConfirm({ id, action: "continue" }, cookie));
	});

	test("the POST of another session is refused, and burns the id", async () => {
		const id = await pending();
		await expectInvalid(
			await postConfirm(
				{ id, action: "continue" },
				await sessionCookieHeader(OTHER_TOKEN),
			),
		);
		await expectInvalid(
			await postConfirm(
				{ id, action: "continue" },
				await sessionCookieHeader(TOKEN),
			),
		);
	});

	test("the origin check accepts the page's own POST", async () => {
		// better-auth turns its origin check off under NODE_ENV=test, once,
		// when it makes the context. Turn it on for this test.
		const context = await auth.$context;
		const previous = context.skipOriginCheck;
		context.skipOriginCheck = false;
		try {
			const cookie = await sessionCookieHeader(TOKEN);
			const post = async (origin: string) =>
				auth.handler(
					new Request(CONFIRM_URL, {
						method: "POST",
						headers: {
							"content-type": "application/x-www-form-urlencoded",
							cookie,
							origin,
						},
						body: new URLSearchParams({
							id: await pending(),
							action: "continue",
						}).toString(),
					}),
				);
			expect((await post(ORIGIN)).status).toBe(302);
			expect((await post("null")).status).toBe(403);
			expect((await post("https://evil.example")).status).toBe(403);
		} finally {
			context.skipOriginCheck = previous;
		}
	});

	test("the POST with no session is refused", async () => {
		const id = await pending();
		await expectInvalid(await postConfirm({ id, action: "continue" }));
	});

	test("an id expires", async () => {
		const old = new Date(Date.now() - CONFIRMATION_TTL_MS - 1);
		const id = await startConfirmation(
			{ challenge: challengeFor(VERIFIER), sessionId: "s-confirm", link: LINK },
			old,
		);
		await expectInvalid(
			await postConfirm(
				{ id, action: "continue" },
				await sessionCookieHeader(TOKEN),
			),
		);
	});
});

describe("the page text", () => {
	test("escapes the email, the origin and the id", async () => {
		const html = await confirmPage({
			id: '"><script>alert(1)</script>',
			email: "<img src=x onerror=alert(1)>@example.com",
			serverOrigin: "https://a.example/<b>",
			action: "/api/auth/mobile/confirm",
		}).text();
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("<img");
		expect(html).not.toContain("<b>");
		expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;@example.com");
	});
});

// The whole app flow through the real handler. Google's token endpoint is
// the only part that is faked: it answers with an unsigned ID token, which
// better-auth decodes and does not verify on the callback.
describe("the app sign-in, end to end", () => {
	const realFetch = globalThis.fetch;
	const EMAIL = "phone-person@example.com";

	const base64url = (value: Record<string, string | boolean>) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");

	beforeEach(async () => {
		await db.delete(verification);
		await db.delete(session);
		await db.delete(user);
		setInstanceSettingsForTests({
			GOOGLE_CLIENT_ID: "client-id",
			GOOGLE_CLIENT_SECRET: "client-secret",
		});
		const idToken = [
			base64url({ alg: "none", typ: "JWT" }),
			base64url({
				iss: "https://accounts.google.com",
				aud: "client-id",
				sub: "google-person-1",
				email: EMAIL,
				email_verified: true,
				name: "Phone Person",
			}),
			"sig",
		].join(".");
		globalThis.fetch = Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = input instanceof Request ? input.url : input.toString();
				if (!url.startsWith("https://oauth2.googleapis.com/token")) {
					return realFetch(input, init);
				}
				return Response.json({
					access_token: "google-access",
					id_token: idToken,
					token_type: "Bearer",
					expires_in: 3600,
				});
			},
			{ preconnect: realFetch.preconnect },
		);
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
		setInstanceSettingsForTests(undefined);
	});

	/** The `Cookie` header that a browser sends after these answers. */
	const cookieJar = (...responses: Response[]) => {
		const jar = new Map<string, string>();
		for (const response of responses) {
			for (const line of response.headers.getSetCookie()) {
				const [pair = ""] = line.split(";");
				const [name = "", ...value] = pair.split("=");
				jar.set(name, value.join("="));
			}
		}
		return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
	};

	const startAnswer = z.object({ url: z.string() });

	/** Start, proxy and callback: what the app and the browser do before the
	 *  confirmation page. Returns the callback's answer. */
	const throughCallback = async () => {
		const callbackURL = `${LINK}&cc=${challengeFor(VERIFIER)}`;
		const started = await auth.handler(
			new Request(`${ORIGIN}/api/auth/sign-in/social`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"expo-origin": "farmer://",
				},
				body: JSON.stringify({
					provider: "google",
					callbackURL,
					errorCallbackURL: callbackURL,
					newUserCallbackURL: callbackURL,
					disableRedirect: true,
				}),
			}),
		);
		const { url } = startAnswer.parse(await started.json());
		const proxied = await auth.handler(
			new Request(
				`${ORIGIN}/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL: url })}`,
			),
		);
		expect(proxied.status).toBe(302);
		const state = present(new URL(url).searchParams.get("state"), "state");
		const callback = await auth.handler(
			new Request(
				`${ORIGIN}/api/auth/callback/google?${new URLSearchParams({ state, code: "google-code" })}`,
				{ headers: { cookie: cookieJar(proxied) } },
			),
		);
		return callback;
	};

	test("the callback goes to the confirmation page, not to the app", async () => {
		const callback = await throughCallback();
		expect(callback.status).toBe(302);
		const location = present(callback.headers.get("location"), "location");
		expect(location.startsWith(`${CONFIRM_URL}?id=`)).toBe(true);
		expect(location).not.toContain("farmer:");
		expect(location).not.toContain("cookie");
		expect(location).not.toContain("cc=");
		const [row] = await db.select().from(session);
		expect(location).not.toContain(present(row, "the session").token);
	});

	test("start, proxy, callback, page, POST, link and exchange", async () => {
		const callback = await throughCallback();
		const cookie = cookieJar(callback);
		const pageUrl = present(callback.headers.get("location"), "location");
		const shown = await auth.handler(
			new Request(pageUrl, { headers: { cookie } }),
		);
		expect(shown.status).toBe(200);
		expect(await shown.text()).toContain(EMAIL);

		const id = present(new URL(pageUrl).searchParams.get("id"), "id");
		const sent = await postConfirm({ id, action: "continue" }, cookie);
		expect(sent.status).toBe(302);
		const link = present(sent.headers.get("location"), "the app link");
		// The app compares the link with this prefix (`redirectPrefixFor`).
		expect(link.startsWith(LINK)).toBe(true);
		const code = present(new URL(link).searchParams.get("code"), "the code");

		const exchanged = await auth.handler(
			new Request(`${ORIGIN}/api/auth/mobile/exchange`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code, verifier: VERIFIER }),
			}),
		);
		expect(exchanged.status).toBe(200);
		const { token } = z
			.object({ token: z.string() })
			.parse(await exchanged.json());
		const [row] = await db.select().from(session);
		expect(token).toBe(present(row, "the session").token);
	});
});
