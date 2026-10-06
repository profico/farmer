/**
 * Drive the mobile sign-in as the `@better-auth/expo` client does, against a
 * running dev server and a mock OpenID Connect provider. No phone. The
 * result is in ADR 0005. It covers the exchange code: the `cc` challenge, the
 * `code` in the link, the one use, and the wrong verifier.
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

import { createHash, randomBytes } from "node:crypto";

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

// 1. The OpenID Connect source, end to end, with no challenge: the exchange is
// the only path, so the link must not carry a session.
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
	const params = new URL(location || "farmer://x").searchParams;
	check(
		"No cc: 302 to farmer://auth-callback with error=exchange_failed, no cookie",
		location.startsWith(`${APP_CALLBACK}?`) &&
			params.get("error") === "exchange_failed" &&
			!params.has("cookie") &&
			!params.has("code") &&
			!location.includes("session_token"),
		`${final?.status} ${redact(location)}`,
	);
}

// 1b. The exchange code (ADR 0005). The app sends an S256 challenge as `cc`
// in the `callbackURL`. The link must carry `code` and no `cookie`, and the
// code must buy a session only once and only with the verifier.
const FLOW_CALLBACK = `${APP_CALLBACK}?flow=spike-nonce`;
const makeVerifier = () => randomBytes(32).toString("base64url");
const challengeOf = (verifier: string) =>
	createHash("sha256").update(verifier).digest("base64url");

const exchangeLeg = async (verifier: string) => {
	const callbackURL = `${FLOW_CALLBACK}&cc=${encodeURIComponent(challengeOf(verifier))}`;
	const started = await start("/sign-in/oauth2", {
		providerId: "spike-oidc",
		callbackURL,
		errorCallbackURL: callbackURL,
	});
	if (!started.parsed.success) return { started, location: "" };
	const { proxy, final } = await browserLeg(started.parsed.data.url);
	return { started, proxy, location: final?.location ?? "" };
};

const redeem = (code: string, verifier: string) =>
	fetch(`${FARMER}/api/auth/mobile/exchange`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ code, verifier }),
	});

const tokenFrom = async (response: Response) => {
	const parsed = z
		.object({ token: z.string() })
		.safeParse(await response.json().catch(() => null));
	return parsed.success ? parsed.data.token : "";
};

const verifier = makeVerifier();
const leg = await exchangeLeg(verifier);
check(
	"cc: the proxy accepts a callbackURL with the cc query",
	leg.started.status === 200 && leg.proxy?.status === 302,
	`${leg.started.status} ${leg.proxy?.status} ${leg.proxy?.location ? "to the provider" : ""}`,
);
const link = leg.location ? new URL(leg.location) : null;
const code = link?.searchParams.get("code") ?? "";
check(
	"cc: the farmer:// link has code and flow, and no cookie or cc",
	link !== null &&
		leg.location.startsWith(`${APP_CALLBACK}?`) &&
		code.length > 0 &&
		link.searchParams.get("flow") === "spike-nonce" &&
		!link.searchParams.has("cookie") &&
		!link.searchParams.has("cc") &&
		!leg.location.includes("session_token"),
	redact(leg.location) ?? "",
);
const wrong = await redeem(code, makeVerifier());
check(
	"cc: a wrong verifier is refused",
	wrong.status === 400,
	`${wrong.status} ${await wrong.text()}`,
);
const afterWrong = await redeem(code, verifier);
check(
	"cc: the wrong attempt burned the code",
	afterWrong.status === 400,
	`${afterWrong.status}`,
);

const leg2 = await exchangeLeg(verifier);
const code2 = new URL(leg2.location || "farmer://x").searchParams.get("code");
const good = await redeem(code2 ?? "", verifier);
const token = await tokenFrom(good);
check(
	"cc: the right verifier returns a token",
	good.status === 200 && token.length > 0,
	`${good.status}`,
);
const meExchange = await fetch(`${FARMER}/api/v1/me`, {
	headers: { authorization: `Bearer ${token}` },
});
check(
	"cc: the token works as a bearer on GET /api/v1/me",
	meExchange.status === 200,
	`${meExchange.status} ${(await meExchange.text()).slice(0, 120)}`,
);
const again = await redeem(code2 ?? "", verifier);
check(
	"cc: a second exchange is refused",
	again.status === 400,
	`${again.status}`,
);

const leg3 = await exchangeLeg(verifier);
const badChallenge = await start("/sign-in/oauth2", {
	providerId: "spike-oidc",
	callbackURL: `${FLOW_CALLBACK}&cc=short`,
	errorCallbackURL: `${FLOW_CALLBACK}&cc=short`,
});
if (badChallenge.parsed.success) {
	const { final } = await browserLeg(badChallenge.parsed.data.url);
	const params = new URL(final?.location ?? "farmer://x").searchParams;
	check(
		"cc: a cc that is not a challenge gives error=exchange_failed, no session",
		params.get("error") === "exchange_failed" &&
			!params.has("cookie") &&
			!params.has("code"),
		`${final?.status} ${redact(final?.location ?? null)}`,
	);
}
check(
	"cc: a third flow also returns a code",
	new URL(leg3.location || "farmer://x").searchParams.has("code"),
	redact(leg3.location) ?? "",
);

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
	// `handleOAuthUserInfo` as a string. The link has no `cookie` and no
	// `code`.
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

// 2b. The same refusal with a cc: the provider's error must reach the app
// as it did before, and no session or code may be in the link.
const strangerCc = await start("/sign-in/oauth2", {
	providerId: "stranger-oidc",
	callbackURL: `${FLOW_CALLBACK}&cc=${challengeOf(makeVerifier())}`,
	errorCallbackURL: `${FLOW_CALLBACK}&cc=${challengeOf(makeVerifier())}`,
});
if (strangerCc.parsed.success) {
	const { final } = await browserLeg(strangerCc.parsed.data.url);
	const params = new URL(final?.location ?? "farmer://x").searchParams;
	check(
		"cc, refused sign-in: the provider's error reaches the app, no code",
		(params.get("error") ?? "").startsWith("This_instance_does_not") &&
			!params.has("cookie") &&
			!params.has("code"),
		`${final?.status} ${redact(final?.location ?? null)}`,
	);
} else {
	check("cc, refused sign-in: start", false, `${strangerCc.status}`);
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
