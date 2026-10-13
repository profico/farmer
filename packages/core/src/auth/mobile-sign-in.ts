import { createHash, randomBytes } from "node:crypto";

import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, eq, gt, like, lt } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { verification } from "../db/schema/auth";
import { enabledOAuthProviders } from "../services/instance-settings.service";
import { googleCredentials } from "./sign-in-methods";

/**
 * The mobile app's sign-in through `@better-auth/expo` (ADR 0005).
 *
 * The app starts a provider sign-in with the header `expo-origin: farmer://`
 * and a `callbackURL` on the `farmer://` scheme. The plugin copies that header
 * into `origin`, so the origin check accepts the request. After the provider
 * callback, the plugin adds the session cookie to the `farmer://` redirect as
 * the `cookie` query parameter. `mobile-exchange.ts` replaces it with a
 * one-time code, so the link never carries the session.
 *
 * `farmer://` is the only origin that this file adds. A trusted origin that
 * is not http(s) matches by prefix (better-auth's `matchesOriginPattern`), so
 * the entry accepts every `farmer://` link and no other scheme; a `farmer://*`
 * pattern would add nothing. The plugin adds `exp://` itself, and only when
 * `NODE_ENV` is `development` (Expo Go).
 */
export const MOBILE_TRUSTED_ORIGINS = ["farmer://"];

/** The plugin's GET endpoint that the app opens in the system browser. */
export const EXPO_PROXY_PATH = "/expo-authorization-proxy";

/**
 * The proxy's query. `oauthState` is for the cookie state strategy, which
 * this server does not use (a database is configured), so it is refused.
 * `token` is optional here on purpose: a query that does not parse skips the
 * guard, so the guard itself refuses a missing token.
 */
export const expoProxyQuery = z.object({
	authorizationURL: z.string(),
	oauthState: z.string().optional(),
	token: z.string().max(128).optional(),
});

/** How long a proxy token lives. The plugin's state cookie lives 300 s. */
export const PROXY_TOKEN_TTL_MS = 5 * 60_000;

const PROXY_PREFIX = "mobile-proxy:";

const proxyIdentifier = (token: string) =>
	`${PROXY_PREFIX}${createHash("sha256").update(token).digest("hex")}`;

/**
 * Stores a one-time proxy token for the authorization URL that the server
 * made for a flow, and returns the token. The server keeps only the hash.
 * Rows that expired are removed here, so the table does not grow.
 */
export const mintProxyToken = async (
	authorizationURL: string,
	now: Date = new Date(),
): Promise<string> => {
	await db
		.delete(verification)
		.where(
			and(
				like(verification.identifier, `${PROXY_PREFIX}%`),
				lt(verification.expiresAt, now),
			),
		);
	const token = randomBytes(32).toString("base64url");
	await db.insert(verification).values({
		id: randomBytes(16).toString("hex"),
		identifier: proxyIdentifier(token),
		value: authorizationURL,
		expiresAt: new Date(now.getTime() + PROXY_TOKEN_TTL_MS),
	});
	return token;
};

/**
 * Spends a proxy token and returns the authorization URL it was made for, or
 * null for an unknown, used or expired token. The delete is the single use:
 * it removes the row and returns it in one statement.
 */
export const redeemProxyToken = async (
	token: string,
	now: Date = new Date(),
): Promise<string | null> => {
	const [row] = await db
		.delete(verification)
		.where(
			and(
				eq(verification.identifier, proxyIdentifier(token)),
				gt(verification.expiresAt, now),
			),
		)
		.returning({ value: verification.value });
	return row?.value ?? null;
};

const startAnswer = z.looseObject({ url: z.string() });

/**
 * Adds `proxyToken` to the answer of a sign-in start from the app (a request
 * with the header `expo-origin`). The app must give the token back to the
 * proxy, so a `state` that somebody else started cannot be sent into another
 * browser. The plugin must come after `expo()` in the plugin list.
 */
export const mobileProxyToken = () =>
	({
		id: "mobile-proxy-token",
		hooks: {
			after: [
				{
					matcher: (context) =>
						!!(
							context.path?.startsWith("/sign-in/social") ||
							context.path?.startsWith("/sign-in/oauth2")
						),
					handler: createAuthMiddleware(async (ctx) => {
						const headers = ctx.request?.headers ?? ctx.headers;
						if (!headers?.get("expo-origin")) return;
						const answer = startAnswer.safeParse(ctx.context.returned);
						if (!answer.success) return;
						ctx.context.returned = {
							...answer.data,
							proxyToken: await mintProxyToken(answer.data.url),
						};
					}),
				},
			],
		},
	}) satisfies BetterAuthPlugin;

/** The part of a stored OAuth state that the guard reads. */
const storedState = z.looseObject({ callbackURL: z.string() });

const refused = (message: string) =>
	new APIError("BAD_REQUEST", {
		message,
		code: "INVALID_AUTHORIZATION_URL",
	});

/**
 * The origins that the proxy may send a browser to: Google when it is
 * configured, and the origin of each enabled OpenID Connect source.
 *
 * The origin of a source's base URL (its issuer) stands in for the origin of
 * its authorization endpoint. That holds for the usual identity providers
 * (Google, Entra ID, Okta, Keycloak, GitLab, Authentik). A provider whose
 * authorization endpoint is on a different host fails closed: the app cannot
 * sign in with it, and nobody is sent anywhere else.
 */
const providerOrigins = (): Set<string> => {
	const origins = new Set<string>();
	if (googleCredentials()) origins.add("https://accounts.google.com");
	for (const provider of enabledOAuthProviders()) {
		try {
			origins.add(new URL(provider.baseUrl).origin);
		} catch {
			// A base URL that does not parse cannot match anything.
		}
	}
	return origins;
};

/**
 * Refuse a proxy request that this server did not start for the app.
 *
 * The plugin's endpoint redirects to ANY https URL and sets a signed `state`
 * cookie from the URL's own `state` parameter. Unguarded, that is an open
 * redirect on this origin, and a way to put a chosen state cookie into a
 * visitor's browser. Four checks close it:
 *
 *  0. The query holds the one-time token that this server gave to the app
 *     that started the flow, and the `authorizationURL` is exactly the URL
 *     that the server made for that token. Without it, an attacker could
 *     start a flow, and send the proxy link with their own state to a
 *     victim. The token is spent first, so a refused attempt burns it. The
 *     whole URL is compared, not its origin: a provider URL with another
 *     `client_id` or `redirect_uri` is refused.
 *  1. The target's origin is a configured identity provider. This is the
 *     check that stops the open redirect, because anybody can start a real
 *     flow with curl and get a valid state.
 *  2. No `oauthState`: see `expoProxyQuery`.
 *  3. The `state` is a live flow of this server whose callback is a link back
 *     into the app (a trusted origin that is not http or https).
 */
export const assertExpoProxyTarget = async (
	query: z.infer<typeof expoProxyQuery>,
	findState: (state: string) => Promise<string | null>,
	isTrustedOrigin: (url: string) => boolean,
	redeemToken: (token: string) => Promise<string | null> = redeemProxyToken,
): Promise<void> => {
	if (query.oauthState !== undefined) throw refused("Unexpected oauthState");
	const generated = query.token ? await redeemToken(query.token) : null;
	if (generated === null || generated !== query.authorizationURL) {
		throw refused("The token does not match the authorizationURL");
	}
	let target: URL;
	try {
		target = new URL(query.authorizationURL);
	} catch {
		throw refused("Invalid authorizationURL");
	}
	if (!providerOrigins().has(target.origin)) {
		throw refused("The authorizationURL is not a configured provider");
	}
	const state = target.searchParams.get("state");
	const stored = state ? await findState(state) : null;
	if (!stored) throw refused("Unknown state");
	let callbackURL: string;
	try {
		callbackURL = storedState.parse(JSON.parse(stored)).callbackURL;
	} catch {
		throw refused("Unknown state");
	}
	const protocol = URL.parse(callbackURL)?.protocol;
	if (
		!protocol ||
		protocol === "http:" ||
		protocol === "https:" ||
		!isTrustedOrigin(callbackURL)
	) {
		throw refused("The flow does not return to the app");
	}
};
