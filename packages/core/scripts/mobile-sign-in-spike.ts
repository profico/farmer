/**
 * Phase 0 of docs/plans/mobile-app.md: drive the mobile sign-in as the
 * `@better-auth/expo` client does, against a running dev server and a mock
 * OpenID Connect provider. No phone. The result is in ADR 0005.
 *
 * Start these first:
 *
 *   podman run -d -p 127.0.0.1:8443:8443 -e SERVER_PORT=8443 \
 *     -e JSON_CONFIG="$(cat mock.json)" ghcr.io/navikt/mock-oauth2-server
 *   cd apps/web && NODE_TLS_REJECT_UNAUTHORIZED=0 \
 *     GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=y \
 *     bunx --bun vite dev --port 3031 --strictPort
 *
 * `mock.json` serves the issuers `spike` and `stranger` over TLS
 * (`"httpServer": {"type": "NettyWrapper", "ssl": {}}`), with a token callback
 * on each that gives a fixed `sub`, `email` and `email_verified: true`. The
 * provider must be https: the plugin's proxy refuses any other scheme. Set
 * BETTER_AUTH_URL to the server's origin, and run on an EMPTY database (the
 * first account is allowed in, a second one is not).
 *
 *   bun run scripts/mobile-sign-in-spike.ts
 *
 * Two cookie jars, because the app and the system browser do not share one:
 * the app holds the answer to the sign-in POST, and the browser holds only
 * what the proxy, the provider and the callback set. One jar would pass even
 * if the proxy never set the state cookie.
 */

import { z } from "zod";

import { auth } from "../src/auth";
import { instanceSettingsService } from "../src/services/instance-settings.service";

const FARMER = process.env.SPIKE_FARMER_URL ?? "http://localhost:3031";
const MOCK = process.env.SPIKE_MOCK_URL ?? "https://localhost:8443";
const APP_CALLBACK = "farmer://auth-callback";

type Jar = Map<string, string>;

/** The mock's certificate is self-signed. */
const insecure = { tls: { rejectUnauthorized: false } };

const store = (jar: Jar, response: Response) => {
	for (const line of response.headers.getSetCookie()) {
		const [pair = ""] = line.split(";");
		const at = pair.indexOf("=");
		if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1));
	}
};

const cookieHeader = (jar: Jar) =>
	[...jar].map(([name, value]) => `${name}=${value}`).join("; ");

/** One browser hop: a GET with the jar, no redirect followed. */
const browserGet = async (jar: Jar, url: string) => {
	const response = await fetch(url, {
		redirect: "manual",
		headers: jar.size > 0 ? { cookie: cookieHeader(jar) } : {},
		...insecure,
	});
	store(jar, response);
	return {
		status: response.status,
		location: response.headers.get("location"),
	};
};

const redact = (location: string | null) =>
	location?.replace(/(cookie|code|state)=[^&]+/g, "$1=<redacted>") ?? null;

const startBody = z.object({ url: z.string(), redirect: z.boolean() });

const results: { step: string; pass: boolean; evidence: string }[] = [];
const check = (step: string, pass: boolean, evidence: string) => {
	results.push({ step, pass, evidence });
	console.log(`${pass ? "PASS" : "FAIL"}  ${step}\n      ${evidence}`);
};

/** The app's POST, as `expoClient` sends it. */
const start = async (
	path: "/sign-in/oauth2" | "/sign-in/social",
	body: Record<string, string>,
	headers: Record<string, string> = { "expo-origin": "farmer://" },
) => {
	const appJar: Jar = new Map();
	const response = await fetch(`${FARMER}/api/auth${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
	store(appJar, response);
	const text = await response.text();
	const parsed = startBody.safeParse(JSON.parse(text || "null"));
	return { status: response.status, text, parsed, appJar };
};

/** The browser leg, from the proxy to the last redirect of the callback. */
const browserLeg = async (authorizationURL: string) => {
	const browser: Jar = new Map();
	const proxy = await browserGet(
		browser,
		`${FARMER}/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL })}`,
	);
	if (proxy.status !== 302 || !proxy.location) return { proxy, final: null };
	const provider = await browserGet(browser, proxy.location);
	if (!provider.location) return { proxy, final: null };
	const callback = await browserGet(browser, provider.location);
	return { proxy, final: callback };
};

/** The session token inside the deep link's `cookie` parameter. */
const bearerFrom = (deepLink: string) => {
	const setCookie = new URL(deepLink).searchParams.get("cookie") ?? "";
	const match = /(?:__Secure-)?better-auth\.session_token=([^;]+)/.exec(
		setCookie,
	);
	const signed = match?.[1] ? decodeURIComponent(match[1]) : "";
	return signed.split(".")[0] ?? "";
};

const ensureSource = async (providerId: string, issuer: string) => {
	const rows = await instanceSettingsService.listOAuthProviders();
	if (rows.some((row) => row.providerId === providerId)) return;
	await instanceSettingsService.createOAuthProvider({
		providerId,
		name: providerId,
		baseUrl: `${MOCK}/${issuer}`,
		clientId: "farmer-spike",
		clientSecret: "farmer-spike-secret",
		scopes: "",
		enabled: true,
		trustsEmail: false,
	});
};

// 0. The two sources, as a platform admin adds them on Infrastructure ->
// Sign-in, and the trusted origins this build ends up with.
await ensureSource("spike-oidc", "spike");
await ensureSource("stranger-oidc", "stranger");
console.log("trustedOrigins:", (await auth.$context).trustedOrigins);
// The dev server reads the settings again within five seconds.
await Bun.sleep(6_000);

// 1. The OpenID Connect source, end to end.
const oidc = await start("/sign-in/oauth2", {
	providerId: "spike-oidc",
	callbackURL: APP_CALLBACK,
	errorCallbackURL: APP_CALLBACK,
});
check(
	"OIDC start: POST /sign-in/oauth2 with expo-origin",
	oidc.status === 200 && oidc.parsed.success,
	`${oidc.status} ${redact(oidc.parsed.data?.url ?? oidc.text)}`,
);
if (oidc.parsed.success) {
	const { proxy, final } = await browserLeg(oidc.parsed.data.url);
	check(
		"OIDC proxy: 302 to the provider",
		proxy.status === 302 && (proxy.location ?? "").startsWith(MOCK),
		`${proxy.status} ${redact(proxy.location)}`,
	);
	const location = final?.location ?? "";
	check(
		"OIDC callback: 302 to farmer://auth-callback with the cookie",
		location.startsWith(`${APP_CALLBACK}?`) && location.includes("cookie="),
		`${final?.status} ${redact(location)}`,
	);
	const token = bearerFrom(location);
	const me = await fetch(`${FARMER}/api/v1/me`, {
		headers: { authorization: `Bearer ${token}` },
	});
	check(
		"GET /api/v1/me with the session token as a bearer",
		me.status === 200,
		`${me.status} ${(await me.text()).slice(0, 120)}`,
	);
}

// 2. A refused sign-in comes back to the app as an error, with no cookie.
const stranger = await start("/sign-in/oauth2", {
	providerId: "stranger-oidc",
	callbackURL: APP_CALLBACK,
	errorCallbackURL: APP_CALLBACK,
});
if (stranger.parsed.success) {
	const { final } = await browserLeg(stranger.parsed.data.url);
	const location = final?.location ?? "";
	// The `error` is the gate's message with "_" for each space, not its
	// code: genericOAuth's callback gets the refusal back from
	// `handleOAuthUserInfo` as a string. The `cookie` parameter carries only
	// the expired state cookie, never a session.
	const params = new URL(location).searchParams;
	check(
		"Refused sign-in: farmer://auth-callback?error=..., no session",
		location.startsWith(`${APP_CALLBACK}?`) &&
			(params.get("error") ?? "").startsWith("This_instance_does_not") &&
			!(params.get("cookie") ?? "").includes("session_token"),
		`${final?.status} ${redact(location)}`,
	);
} else {
	check("Refused sign-in: start", false, `${stranger.status} ${stranger.text}`);
}

// 3. Google: the start and the proxy. The callback needs Google itself, and
// it runs through the same after-hook as the OIDC one.
const google = await start("/sign-in/social", {
	provider: "google",
	callbackURL: APP_CALLBACK,
});
check(
	"Google start: POST /sign-in/social with expo-origin",
	google.status === 200 &&
		(google.parsed.data?.url ?? "").startsWith("https://accounts.google.com/"),
	`${google.status} ${redact(google.parsed.data?.url ?? google.text)}`,
);
if (google.parsed.success) {
	const proxy = await browserGet(
		new Map(),
		`${FARMER}/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL: google.parsed.data.url })}`,
	);
	check(
		"Google proxy: 302 to accounts.google.com",
		proxy.status === 302 &&
			(proxy.location ?? "").startsWith("https://accounts.google.com/"),
		`${proxy.status} ${redact(proxy.location)}`,
	);
}

// 4. What must not work.
for (const callbackURL of ["https://evil.example/", "otherapp://x"]) {
	const refused = await start("/sign-in/oauth2", {
		providerId: "spike-oidc",
		callbackURL,
	});
	check(
		`callbackURL ${callbackURL} is refused`,
		refused.status === 403 && refused.text.includes("INVALID_CALLBACK_URL"),
		`${refused.status} ${refused.text}`,
	);
}
const expGo = await start("/sign-in/oauth2", {
	providerId: "spike-oidc",
	callbackURL: "exp://192.168.0.2:8081/--/auth-callback",
});
check(
	"exp:// is accepted (development only, from the plugin)",
	expGo.status === 200,
	`${expGo.status}`,
);
for (const [label, query] of [
	["an open redirect", { authorizationURL: "https://evil.example/?state=x" }],
	[
		"an oauthState",
		{ authorizationURL: `${MOCK}/spike/authorize`, oauthState: "x" },
	],
	[
		"a state this server did not issue",
		{ authorizationURL: `${MOCK}/spike/authorize?state=forged` },
	],
] as const) {
	const proxy = await browserGet(
		new Map(),
		`${FARMER}/api/auth/expo-authorization-proxy?${new URLSearchParams(query)}`,
	);
	check(
		`The proxy refuses ${label}`,
		proxy.status === 400,
		`${proxy.status} ${proxy.location ?? ""}`,
	);
}

// 5. The web sign-in, without expo-origin, is as it was.
const web = await start(
	"/sign-in/oauth2",
	{ providerId: "spike-oidc", callbackURL: "/" },
	{},
);
if (web.parsed.success) {
	const browser: Jar = new Map(web.appJar);
	const provider = await browserGet(browser, web.parsed.data.url);
	const callback = await browserGet(browser, provider.location ?? "");
	const location = callback.location ?? "";
	check(
		"Web sign-in: the callback goes to the site, with no cookie parameter",
		callback.status === 302 &&
			!location.startsWith("farmer:") &&
			!location.includes("cookie="),
		`${callback.status} ${redact(location)}`,
	);
} else {
	check("Web sign-in: start", false, `${web.status} ${web.text}`);
}

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
