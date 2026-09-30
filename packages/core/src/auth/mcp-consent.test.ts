// Every MCP authorization stops at the consent screen (`./mcp-consent.ts`).
// Through `auth.handler`, as a browser and an MCP client reach it, so the
// hooks run exactly where the plugin runs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { setInstanceSettingsForTests } from "../lib/instance-settings";
import { createTestDb, present, type TestDb } from "../test/harness";
import { auth, mcpConsentRequest } from "./index";
import { MCP_CONSENT_PAGE } from "./mcp-consent";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct horse battery";
const VERIFIER = "a-code-verifier-that-is-long-enough-for-pkce-0123456789";
const STRANGER_REDIRECT = "https://evil.example/cb";
const LOOPBACK_REDIRECT = "http://127.0.0.1:33418/callback";

let harness: TestDb;
let person: { id: string; cookie: string };
let otherPerson: { id: string; cookie: string };

const challenge = async () =>
	Buffer.from(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VERIFIER)),
	).toString("base64url");

/** The `name=value` pairs of a response's cookies, as a request header. */
const cookiesOf = (response: Response) =>
	response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");

const signUp = async (email: string) => {
	const response = await auth.api.signUpEmail({
		body: { name: email, email, password: PASSWORD },
		asResponse: true,
	});
	const body = await response.json();
	return { id: String(body.user.id), cookie: cookiesOf(response) };
};

/** Anonymous dynamic registration, as any MCP client (or anybody) sends it. */
const register = async (redirectUris: string[], name = "Claude Code") => {
	const response = await auth.handler(
		new Request(`${ORIGIN}/api/auth/mcp/register`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				client_name: name,
				redirect_uris: redirectUris,
				token_endpoint_auth_method: "none",
			}),
		}),
	);
	expect(response.status).toBe(201);
	return String((await response.json()).client_id);
};

const authorize = async (
	clientId: string,
	redirectUri: string,
	cookie: string | null,
	prompt: string | null = null,
) => {
	const query = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: "openid offline_access",
		state: "client-state",
		code_challenge: await challenge(),
		code_challenge_method: "S256",
	});
	if (prompt) query.set("prompt", prompt);
	return auth.handler(
		new Request(`${ORIGIN}/api/auth/mcp/authorize?${query}`, {
			headers: cookie ? { cookie } : {},
		}),
	);
};

/** Where a redirect points, and the consent code when it is the screen. */
const locationOf = (response: Response) => {
	expect(response.status).toBe(302);
	return new URL(
		present(response.headers.get("location"), "a location"),
		ORIGIN,
	);
};

const consentCodeOf = (response: Response) => {
	const location = locationOf(response);
	expect(location.pathname).toBe(MCP_CONSENT_PAGE);
	return present(location.searchParams.get("consent_code"), "a consent code");
};

const decide = (cookie: string, consentCode: string, accept: boolean) =>
	auth.handler(
		new Request(`${ORIGIN}/api/auth/oauth2/consent`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: ORIGIN, cookie },
			body: JSON.stringify({ accept, consent_code: consentCode }),
		}),
	);

/** A token request, form-encoded as most clients send it, or as JSON. */
const token = (body: URLSearchParams | string) =>
	auth.handler(
		new Request(`${ORIGIN}/api/auth/mcp/token`, {
			method: "POST",
			headers: {
				"content-type":
					body instanceof URLSearchParams
						? "application/x-www-form-urlencoded"
						: "application/json",
			},
			body,
		}),
	);

const exchange = (clientId: string, code: string, redirectUri: string) =>
	token(
		new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			client_id: clientId,
			code_verifier: VERIFIER,
		}),
	);

/** Approve as the person, and return the code the redirect carries. */
const approve = async (consentCode: string, redirectUri: string) => {
	const response = await decide(person.cookie, consentCode, true);
	expect(response.status).toBe(200);
	const target = new URL((await response.json()).redirectURI);
	expect(`${target.protocol}//${target.host}${target.pathname}`).toBe(
		new URL(redirectUri).href.replace(/\?.*$/, ""),
	);
	expect(target.searchParams.get("state")).toBe("client-state");
	return present(target.searchParams.get("code"), "an authorization code");
};

/** A loopback client the person has approved, and its spendable code. */
const approvedCode = async () => {
	const clientId = await register([LOOPBACK_REDIRECT]);
	const consentCode = consentCodeOf(
		await authorize(clientId, LOOPBACK_REDIRECT, person.cookie),
	);
	return { clientId, code: await approve(consentCode, LOOPBACK_REDIRECT) };
};

beforeAll(async () => {
	harness = await createTestDb();
	setInstanceSettingsForTests({ REGISTRATION_OPEN: "true" });
	person = await signUp("person@example.com");
	otherPerson = await signUp("other@example.com");
});

afterAll(async () => {
	setInstanceSettingsForTests(undefined);
	await harness.close();
});

describe("an MCP authorization without the person's approval", () => {
	test("goes to the consent screen, not to the redirect, whatever the client asks", async () => {
		const clientId = await register([STRANGER_REDIRECT], "Totally Claude");
		for (const prompt of [null, "none", "login consent"]) {
			const response = await authorize(
				clientId,
				STRANGER_REDIRECT,
				person.cookie,
				prompt,
			);
			const location = locationOf(response);
			expect(location.origin).toBe(ORIGIN);
			expect(location.pathname).toBe(MCP_CONSENT_PAGE);
			expect(location.searchParams.has("code")).toBe(false);
		}
	});

	test("cannot be exchanged while the consent is pending, in any shape", async () => {
		const clientId = await register([STRANGER_REDIRECT]);
		const consentCode = consentCodeOf(
			await authorize(clientId, STRANGER_REDIRECT, person.cookie),
		);
		const fields = {
			redirect_uri: STRANGER_REDIRECT,
			client_id: clientId,
			code_verifier: VERIFIER,
		};
		for (const body of [
			new URLSearchParams({
				grant_type: "authorization_code",
				code: consentCode,
				...fields,
			}),
			// The handler spends `code.toString()`, so an array is the code.
			JSON.stringify({
				grant_type: "authorization_code",
				code: [consentCode],
				...fields,
			}),
			// And it spends a code whatever `grant_type` says, short of a refresh.
			JSON.stringify({ code: consentCode, ...fields }),
		]) {
			const response = await token(body);
			expect(response.status).toBe(401);
			expect((await response.json()).error).toBe("invalid_grant");
		}
		// Still pending, so still the person's to decide.
		expect(await mcpConsentRequest(person.id, consentCode)).not.toBeNull();
	});

	test("cannot be approved by another account", async () => {
		const clientId = await register([STRANGER_REDIRECT]);
		const consentCode = consentCodeOf(
			await authorize(clientId, STRANGER_REDIRECT, person.cookie),
		);
		const response = await decide(otherPerson.cookie, consentCode, true);
		expect(response.status).toBe(403);
		expect(await mcpConsentRequest(otherPerson.id, consentCode)).toBeNull();
		// Still the person's to decide.
		expect(await mcpConsentRequest(person.id, consentCode)).toEqual({
			clientName: "Claude Code",
			destination: "https://evil.example",
			local: false,
		});
	});

	test("is refused at the token endpoint when no approval was ever recorded", async () => {
		// A code written the way the plugin writes one without a prompt, as a
		// login cookie saved before this check existed would still replay.
		const clientId = await register([LOOPBACK_REDIRECT]);
		const context = await auth.$context;
		await context.internalAdapter.createVerificationValue({
			identifier: "code-that-skipped-consent",
			value: JSON.stringify({
				clientId,
				redirectURI: LOOPBACK_REDIRECT,
				scope: ["openid"],
				userId: person.id,
				authTime: Date.now(),
				requireConsent: false,
				state: null,
				codeChallenge: await challenge(),
				codeChallengeMethod: "s256",
			}),
			expiresAt: new Date(Date.now() + 600_000),
		});
		const response = await exchange(
			clientId,
			"code-that-skipped-consent",
			LOOPBACK_REDIRECT,
		);
		expect(response.status).toBe(401);
	});

	test("denied, sends the client an error and no code", async () => {
		const clientId = await register([LOOPBACK_REDIRECT]);
		const consentCode = consentCodeOf(
			await authorize(clientId, LOOPBACK_REDIRECT, person.cookie),
		);
		const response = await decide(person.cookie, consentCode, false);
		expect(response.status).toBe(200);
		const target = new URL((await response.json()).redirectURI);
		expect(target.searchParams.get("error")).toBe("access_denied");
		expect(target.searchParams.has("code")).toBe(false);
		const spent = await exchange(clientId, consentCode, LOOPBACK_REDIRECT);
		expect(spent.status).not.toBe(200);
	});
});

describe("an MCP authorization the person approves", () => {
	test("completes for a loopback, a web and a custom-scheme client", async () => {
		for (const redirectUri of [
			LOOPBACK_REDIRECT,
			"https://claude.ai/api/mcp/auth_callback",
			"cursor://anysphere.cursor-mcp/oauth/callback",
		]) {
			const clientId = await register([redirectUri]);
			const consentCode = consentCodeOf(
				await authorize(clientId, redirectUri, person.cookie),
			);
			expect(await mcpConsentRequest(person.id, consentCode)).toMatchObject({
				clientName: "Claude Code",
				local: redirectUri === LOOPBACK_REDIRECT,
			});
			const code = await approve(consentCode, redirectUri);
			const response = await exchange(clientId, code, redirectUri);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.access_token).toBeTruthy();
			expect(body.refresh_token).toBeTruthy();
		}
	});

	test("takes an approved code in the shapes the endpoint always took", async () => {
		const { clientId, code } = await approvedCode();
		const response = await token(
			JSON.stringify({
				grant_type: "authorization_code",
				code: [code],
				redirect_uri: LOOPBACK_REDIRECT,
				client_id: clientId,
				code_verifier: VERIFIER,
			}),
		);
		expect(response.status).toBe(200);
	});

	test("refreshes, form-encoded and as JSON, with or without a null code", async () => {
		const { clientId, code } = await approvedCode();
		const first = await exchange(clientId, code, LOOPBACK_REDIRECT);
		expect(first.status).toBe(200);
		let refreshToken = String((await first.json()).refresh_token);

		const refreshes: ((current: string) => URLSearchParams | string)[] = [
			(current) =>
				new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: current,
					client_id: clientId,
				}),
			(current) =>
				JSON.stringify({
					grant_type: "refresh_token",
					refresh_token: current,
					client_id: clientId,
				}),
			// Jackson and System.Text.Json write an absent field as null.
			(current) =>
				JSON.stringify({
					grant_type: "refresh_token",
					refresh_token: current,
					client_id: clientId,
					code: null,
				}),
		];
		for (const refresh of refreshes) {
			const response = await token(refresh(refreshToken));
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.access_token).toBeTruthy();
			refreshToken = String(body.refresh_token);
		}
	});

	test("reaches the consent screen after a signed-out person signs in", async () => {
		const clientId = await register([LOOPBACK_REDIRECT]);
		const signedOut = await authorize(clientId, LOOPBACK_REDIRECT, null);
		expect(locationOf(signedOut).pathname).toBe("/api/mcp-login");

		// The plugin saved the request in a cookie; signing in replays it.
		const signIn = await auth.handler(
			new Request(`${ORIGIN}/api/auth/sign-in/email`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: ORIGIN,
					cookie: cookiesOf(signedOut),
				},
				body: JSON.stringify({
					email: "person@example.com",
					password: PASSWORD,
				}),
			}),
		);
		const consentCode = consentCodeOf(signIn);
		const code = await approve(consentCode, LOOPBACK_REDIRECT);
		const response = await exchange(clientId, code, LOOPBACK_REDIRECT);
		expect(response.status).toBe(200);
	});
});
