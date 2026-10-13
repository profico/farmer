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
 * The proxy's query, as the guard reads it. `oauthState` is for the cookie
 * state strategy, which this server does not use (a database is configured),
 * so it is refused. This schema is stricter than the plugin's (a maximum
 * length, one value for each parameter). That is safe only because the guard
 * refuses a query that does not parse (`assertExpoProxyQuery`).
 */
export const expoProxyQuery = z.object({
	authorizationURL: z.string().max(4096),
	oauthState: z.string().optional(),
});

/** How long the server keeps the authorization URL of a flow. The plugin's
 *  state cookie lives 300 s. */
export const PROXY_URL_TTL_MS = 5 * 60_000;

const PROXY_PREFIX = "mobile-proxy:";

const proxyIdentifier = (state: string) =>
	`${PROXY_PREFIX}${createHash("sha256").update(state).digest("hex")}`;

/**
 * Stores the authorization URL that the server made for an app flow, under
 * the hash of the flow's `state`. Rows that expired are removed here, so the
 * table does not grow. A URL with no `state` is not stored: the proxy refuses
 * it in all cases.
 */
export const rememberAuthorizationURL = async (
	authorizationURL: string,
	now: Date = new Date(),
): Promise<void> => {
	const state = URL.parse(authorizationURL)?.searchParams.get("state");
	if (!state) return;
	await db
		.delete(verification)
		.where(
			and(
				like(verification.identifier, `${PROXY_PREFIX}%`),
				lt(verification.expiresAt, now),
			),
		);
	await db.insert(verification).values({
		id: randomBytes(16).toString("hex"),
		identifier: proxyIdentifier(state),
		value: authorizationURL,
		expiresAt: new Date(now.getTime() + PROXY_URL_TTL_MS),
	});
};

/**
 * Returns the authorization URL that the server made for a `state`, or null
 * for a state that the app did not start, or that expired or was used. The
 * delete is the single use: it removes the row and returns it in one
 * statement.
 */
export const takeAuthorizationURL = async (
	state: string,
	now: Date = new Date(),
): Promise<string | null> => {
	const [row] = await db
		.delete(verification)
		.where(
			and(
				eq(verification.identifier, proxyIdentifier(state)),
				gt(verification.expiresAt, now),
			),
		)
		.returning({ value: verification.value });
	return row?.value ?? null;
};

const startAnswer = z.looseObject({ url: z.string() });

/**
 * Stores the authorization URL of each sign-in start from the app (a request
 * with the header `expo-origin`), so the proxy can compare the URL that it
 * gets with the URL that the server made. The answer does not change. The
 * plugin must come after `expo()` in the plugin list.
 */
export const mobileProxyUrl = () =>
	({
		id: "mobile-proxy-url",
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
						await rememberAuthorizationURL(answer.data.url);
					}),
				},
			],
		},
	}) satisfies BetterAuthPlugin;

/** The part of a stored OAuth state that the guard reads. */
const storedState = z.looseObject({ callbackURL: z.string() });

export const proxyRefused = (message: string) =>
	new APIError("BAD_REQUEST", {
		message,
		code: "INVALID_AUTHORIZATION_URL",
	});

/**
 * Parses the proxy's query, and refuses a query that does not parse: a
 * missing or overlong `authorizationURL`, or a parameter that occurs two
 * times. The guard must fail closed. If it returned, the plugin's endpoint
 * would redirect with no check.
 */
export const assertExpoProxyQuery = (
	query: Parameters<typeof expoProxyQuery.safeParse>[0],
): z.infer<typeof expoProxyQuery> => {
	const parsed = expoProxyQuery.safeParse(query);
	if (!parsed.success) throw proxyRefused("Invalid query");
	return parsed.data;
};

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

/** The `state` of a URL on a configured provider, or a refusal. */
const providerState = (authorizationURL: string): string => {
	const target = URL.parse(authorizationURL);
	if (!target) throw proxyRefused("Invalid authorizationURL");
	if (!providerOrigins().has(target.origin)) {
		throw proxyRefused("The authorizationURL is not a configured provider");
	}
	const state = target.searchParams.get("state");
	if (!state) throw proxyRefused("Unknown state");
	return state;
};

/** Refuses a stored state whose callback is not a link back into the app. */
const assertReturnsToApp = (
	stored: string | null,
	isTrustedOrigin: (url: string) => boolean,
): void => {
	if (!stored) throw proxyRefused("Unknown state");
	let callbackURL: string;
	try {
		callbackURL = storedState.parse(JSON.parse(stored)).callbackURL;
	} catch {
		throw proxyRefused("Unknown state");
	}
	const protocol = URL.parse(callbackURL)?.protocol;
	if (
		!protocol ||
		protocol === "http:" ||
		protocol === "https:" ||
		!isTrustedOrigin(callbackURL)
	) {
		throw proxyRefused("The flow does not return to the app");
	}
};

/**
 * Refuse a proxy request that this server did not start for the app.
 *
 * The plugin's endpoint redirects to ANY https URL and sets a signed `state`
 * cookie from the URL's own `state` parameter. Unguarded, that is an open
 * redirect on this origin, and a way to put a chosen state cookie into a
 * visitor's browser. These checks close it:
 *
 *  1. No `oauthState`: see `expoProxyQuery`.
 *  2. The target's origin is a configured identity provider. This is the
 *     check that stops the open redirect, because anybody can start a real
 *     flow with curl and get a valid state.
 *  3. The `authorizationURL` is exactly the URL that the server made for
 *     that `state` at the start of an app flow. A provider URL with another
 *     `client_id` or `redirect_uri` is refused. The stored URL works once.
 *  4. The `state` is a live flow of this server whose callback is a link back
 *     into the app (a trusted origin that is not http or https).
 *
 * These checks do not stop a person who started a real flow from sending
 * the proxy link to somebody else.
 */
export const assertExpoProxyTarget = async (
	query: z.infer<typeof expoProxyQuery>,
	findState: (state: string) => Promise<string | null>,
	isTrustedOrigin: (url: string) => boolean,
	takeGenerated: (
		state: string,
	) => Promise<string | null> = takeAuthorizationURL,
): Promise<void> => {
	if (query.oauthState !== undefined)
		throw proxyRefused("Unexpected oauthState");
	const state = providerState(query.authorizationURL);
	if ((await takeGenerated(state)) !== query.authorizationURL) {
		throw proxyRefused("The server did not make this authorizationURL");
	}
	assertReturnsToApp(await findState(state), isTrustedOrigin);
};
