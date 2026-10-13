// What `GET /api/v1/meta` tells the mobile app about signing in, and the device
// flow's client ids. The route is a thin read of these functions, so the rules
// are tested here, through the real auth instance and the real settings.
//
// `bun test` runs with NODE_ENV=test, which is development auth. The cases for
// a production server set NODE_ENV=production for one call and put it back.

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";

import { z } from "zod";

import { db } from "../db";
import { user } from "../db/schema/auth";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
import { instanceSettingsService } from "../services/instance-settings.service";
import { createTestDb, type TestDb } from "../test/harness";
import { auth, passwordOffered, signInProviders } from "./index";

let harness: TestDb;

beforeAll(async () => {
	harness = await createTestDb();
});

afterEach(async () => {
	setInstanceSettingsForTests(undefined);
	// The enabled sources live in module state that every test file in the
	// process shares, so a source this file added must go before the next file.
	for (const row of await db.query.instanceOAuthProvider.findMany()) {
		await instanceSettingsService.deleteOAuthProvider(row.id);
	}
});

afterAll(async () => {
	await harness.close();
});

const inProduction = async <T>(run: () => Promise<T>): Promise<T> => {
	const previous = process.env.NODE_ENV;
	process.env.NODE_ENV = "production";
	try {
		return await run();
	} finally {
		process.env.NODE_ENV = previous;
	}
};

describe("the sign-in methods", () => {
	test("name Google as social and an OpenID Connect source as oidc", async () => {
		setInstanceSettingsForTests({
			GOOGLE_CLIENT_ID: "client-id",
			GOOGLE_CLIENT_SECRET: "client-secret",
		});
		await instanceSettingsService.createOAuthProvider({
			providerId: "gitlab",
			name: "GitLab",
			baseUrl: "https://gitlab.example.com",
			clientId: "client",
			clientSecret: "secret",
			scopes: "",
			enabled: true,
			trustsEmail: false,
		});
		expect(signInProviders()).toStrictEqual([
			{ id: "google", name: "Google", kind: "social" },
			{ id: "gitlab", name: "GitLab", kind: "oidc" },
		]);
	});
});

describe("the password flag", () => {
	test("is on in development", async () => {
		expect(await passwordOffered()).toBe(true);
	});

	test("is on for an instance with no account", async () => {
		expect(await inProduction(passwordOffered)).toBe(true);
	});

	test("is off once an account exists and no platform admin has only a password", async () => {
		await db.insert(user).values({
			id: "u-mobile-contract",
			name: "Member",
			email: "member@example.com",
			emailVerified: true,
		});
		expect(await inProduction(passwordOffered)).toBe(false);
	});
});

describe("the device flow client ids", () => {
	// Through the handler: with no `BETTER_AUTH_URL` in a test, only a request
	// gives the endpoint an origin to build the verification link from.
	const start = (clientId: string) =>
		auth.handler(
			new Request("http://localhost:3000/api/auth/device/code", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ client_id: clientId }),
			}),
		);

	test("accepts the CLI and the mobile app", async () => {
		for (const clientId of ["farmer-cli", "farmer-mobile"]) {
			const response = await start(clientId);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				verification_uri: "http://localhost:3000/device",
			});
		}
	});

	test("refuses any other client", async () => {
		const response = await start("somebody-else");
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: "invalid_client" });
	});
});

// The callback check itself is not here: better-auth skips the origin check
// under NODE_ENV=test. `mobile-exchange.test.ts` covers the exchange.
describe("the Expo sign-in", () => {
	const ORIGIN = "http://localhost:3000";
	const APP = "farmer://auth-callback";

	const startGoogle = (callbackURL: string) =>
		auth.handler(
			new Request(`${ORIGIN}/api/auth/sign-in/social`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"expo-origin": "farmer://",
				},
				body: JSON.stringify({ provider: "google", callbackURL }),
			}),
		);

	const proxy = (query: Record<string, string> | string) =>
		auth.handler(
			new Request(
				`${ORIGIN}/api/auth/expo-authorization-proxy?${new URLSearchParams(query)}`,
			),
		);

	const googleConfigured = () =>
		setInstanceSettingsForTests({
			GOOGLE_CLIENT_ID: "client-id",
			GOOGLE_CLIENT_SECRET: "client-secret",
		});

	const startAnswer = z.object({ url: z.string() });

	const startedFlow = async (callbackURL = APP) => {
		const started = await startGoogle(callbackURL);
		expect(started.status).toBe(200);
		return startAnswer.parse(await started.json());
	};

	test("starts a sign-in that returns to the app", async () => {
		googleConfigured();
		const { url } = await startedFlow();
		const sent = await proxy({ authorizationURL: url });
		expect(sent.status).toBe(302);
		expect(sent.headers.get("location")).toBe(url);
	});

	const expectRefused = async (response: Response) => {
		expect(response.status).toBe(400);
		expect(response.headers.get("location")).toBeNull();
		expect(response.headers.get("set-cookie") ?? "").not.toContain("state");
		expect(await response.json()).toMatchObject({
			code: "INVALID_AUTHORIZATION_URL",
		});
	};

	test("the proxy sends a browser only to a configured provider", async () => {
		googleConfigured();
		const { url } = await startedFlow();
		const state = new URL(url).searchParams.get("state") ?? "";
		const queries: Record<string, string>[] = [
			{ authorizationURL: `https://evil.example/?state=${state}` },
			{ authorizationURL: url, oauthState: "x" },
			{
				authorizationURL:
					"https://accounts.google.com/o/oauth2/v2/auth?state=forged",
			},
		];
		for (const query of queries) {
			await expectRefused(await proxy(query));
		}
	});

	test("the proxy refuses a query that does not parse", async () => {
		googleConfigured();
		const { url } = await startedFlow();
		const queries: (Record<string, string> | string)[] = [
			// The query of the review: an extra overlong value used to skip
			// every check, and the answer was a redirect to evil.example.
			{
				authorizationURL: "https://evil.example/?state=x",
				token: "t".repeat(129),
			},
			{ authorizationURL: `${url}&pad=${"p".repeat(4096)}` },
			`authorizationURL=${encodeURIComponent(url)}&authorizationURL=${encodeURIComponent(url)}`,
			`authorizationURL=${encodeURIComponent(url)}&oauthState=a&oauthState=b`,
			{},
		];
		for (const query of queries) {
			await expectRefused(await proxy(query));
		}
	});

	test("the proxy refuses a URL that the server did not make", async () => {
		googleConfigured();
		for (const [name, value] of [
			["client_id", "attacker-client"],
			["redirect_uri", "https://evil.example/callback"],
		] as const) {
			const { url } = await startedFlow();
			const changed = new URL(url);
			changed.searchParams.set(name, value);
			await expectRefused(
				await proxy({ authorizationURL: changed.toString() }),
			);
		}
	});

	test("the proxy refuses a flow that the app did not start", async () => {
		googleConfigured();
		// A start without `expo-origin`: the state is live, but the server
		// stored no authorization URL for it.
		const started = await auth.handler(
			new Request(`${ORIGIN}/api/auth/sign-in/social`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ provider: "google", callbackURL: APP }),
			}),
		);
		const { url } = startAnswer.parse(await started.json());
		await expectRefused(await proxy({ authorizationURL: url }));
	});

	test("the proxy refuses a flow that does not return to the app", async () => {
		googleConfigured();
		const { url } = await startedFlow("/");
		await expectRefused(await proxy({ authorizationURL: url }));
	});
});
