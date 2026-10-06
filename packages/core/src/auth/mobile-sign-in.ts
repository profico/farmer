import { APIError } from "better-auth/api";
import { z } from "zod";

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

/** The proxy's query. `oauthState` is for the cookie state strategy, which
 *  this server does not use (a database is configured), so it is refused. */
export const expoProxyQuery = z.object({
	authorizationURL: z.string(),
	oauthState: z.string().optional(),
});

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
 * visitor's browser. Three checks close it:
 *
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
): Promise<void> => {
	if (query.oauthState !== undefined) throw refused("Unexpected oauthState");
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
