import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { BetterAuthPlugin } from "better-auth";
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
} from "better-auth/api";
import { and, eq, gt, like, lt } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { session, verification } from "../db/schema/auth";

/**
 * The exchange code of the mobile sign-in (ADR 0005).
 *
 * The browser leg of a provider sign-in ends in a `farmer://` link. Another
 * app on the phone can claim the same scheme, so the link must not carry the
 * session. It carries a one-time code. The code is useless without the
 * verifier, a secret that only the app that started the flow holds.
 *
 * The flow, as PKCE (RFC 7636) with the method S256:
 *
 *  1. The app makes a random verifier and sends only its challenge, the
 *     base64url SHA-256 of the verifier, as the `cc` parameter of the
 *     `callbackURL` that it gives to the sign-in start.
 *  2. The provider callback redirects to that `callbackURL`. The `expo()`
 *     plugin adds `cookie=<Set-Cookie>`. The hook below runs after the plugin,
 *     removes the cookie and `cc`, and adds `code=<random>`. The plugin keeps
 *     the `callbackURL` query intact, so `cc` is in the redirect (the proxy
 *     and the OAuth state hold the URL as the app gave it).
 *  3. The app sends the code and the verifier to `POST /mobile/exchange`. The
 *     answer is the session token, the same value that the app read from the
 *     cookie before.
 *
 * The code is 32 random bytes. The server keeps only its SHA-256, in the
 * `verification` table of better-auth, with the challenge and the id of the
 * session. A code lives for `EXCHANGE_TTL_MS` and works once: an attempt
 * deletes the row, whether the verifier is right or not. A wrong verifier
 * burns that one code and no other, so a hostile app that holds a code can
 * stop a sign-in but cannot make a session. The app starts the flow again.
 *
 * A callback with no `cc` is an app from before the exchange. It keeps the
 * old `cookie` link, so an old app works with a new server. The new app
 * asks for the exchange only when `/api/v1/meta` says `signInExchange`.
 */

/** How long a code lives. The app redeems it as soon as the link opens. */
export const EXCHANGE_TTL_MS = 60_000;

export const EXCHANGE_PATH = "/mobile/exchange";

const IDENTIFIER_PREFIX = "mobile-exchange:";

/** A base64url SHA-256 is 43 characters. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (value: string) => createHash("sha256").update(value).digest();

const identifierFor = (code: string) =>
	`${IDENTIFIER_PREFIX}${sha256(code).toString("hex")}`;

/** The S256 challenge of a verifier. */
export const challengeFor = (verifier: string) =>
	sha256(verifier).toString("base64url");

const storedValue = z.object({ challenge: z.string(), sessionId: z.string() });

/**
 * Stores a new code for a session and returns it. The caller puts it in the
 * link. Rows that expired are removed here, so the table does not grow.
 */
export const mintExchangeCode = async (
	sessionId: string,
	challenge: string,
	now: Date = new Date(),
): Promise<string> => {
	await db
		.delete(verification)
		.where(
			and(
				like(verification.identifier, `${IDENTIFIER_PREFIX}%`),
				lt(verification.expiresAt, now),
			),
		);
	const code = randomBytes(32).toString("base64url");
	await db.insert(verification).values({
		id: randomBytes(16).toString("hex"),
		identifier: identifierFor(code),
		value: JSON.stringify({ challenge, sessionId }),
		expiresAt: new Date(now.getTime() + EXCHANGE_TTL_MS),
	});
	return code;
};

/**
 * Turns a code and its verifier into the session token. Returns null for
 * every failure, so the caller cannot say which one it was: an unknown code,
 * a used one, an expired one, a wrong verifier, a session that ended.
 *
 * The delete is the single use. It removes the row and returns it in one
 * statement, so two requests with the same code cannot both get the row.
 */
export const redeemExchangeCode = async (
	code: string,
	verifier: string,
	now: Date = new Date(),
): Promise<string | null> => {
	const [row] = await db
		.delete(verification)
		.where(
			and(
				eq(verification.identifier, identifierFor(code)),
				gt(verification.expiresAt, now),
			),
		)
		.returning({ value: verification.value });
	if (!row) return null;
	let stored: z.infer<typeof storedValue>;
	try {
		stored = storedValue.parse(JSON.parse(row.value));
	} catch {
		return null;
	}
	const expected = Buffer.from(stored.challenge);
	const given = Buffer.from(challengeFor(verifier));
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
		return null;
	}
	const [live] = await db
		.select({ token: session.token })
		.from(session)
		.where(and(eq(session.id, stored.sessionId), gt(session.expiresAt, now)));
	return live?.token ?? null;
};

const refused = () =>
	new APIError("BAD_REQUEST", {
		message: "The code is not valid.",
		code: "INVALID_EXCHANGE",
	});

const exchangeBody = z.object({
	code: z.string().min(1).max(128),
	verifier: z.string().min(43).max(128),
});

/**
 * Rewrites the `farmer://` redirect of a provider callback: the session
 * cookie that `expo()` added becomes a code. Without `cc` the link stays as
 * `expo()` made it (an app from before the exchange). With `cc` the session
 * never reaches the link: a `cc` that is not a challenge, or a callback with
 * no new session, gives `error=exchange_failed` and no cookie.
 */
export const rewriteExchangeRedirect = async (
	location: string,
	newSessionId: string | null,
): Promise<string | null> => {
	let url: URL;
	try {
		url = new URL(location);
	} catch {
		return null;
	}
	if (url.protocol === "http:" || url.protocol === "https:") return null;
	if (!url.searchParams.has("cookie")) return null;
	const challenge = url.searchParams.get("cc");
	if (challenge === null) return null;
	url.searchParams.delete("cookie");
	url.searchParams.delete("cc");
	if (newSessionId && CHALLENGE.test(challenge)) {
		url.searchParams.set(
			"code",
			await mintExchangeCode(newSessionId, challenge),
		);
	} else {
		url.searchParams.set("error", "exchange_failed");
	}
	return url.toString();
};

/**
 * The plugin. It must come after `expo()` in the plugin list: the hooks of
 * plugins run in the order of the list, and this one reads what `expo()`
 * wrote.
 */
export const mobileExchange = () =>
	({
		id: "mobile-exchange",
		hooks: {
			after: [
				{
					matcher: (context) =>
						!!(
							context.path?.startsWith("/callback") ||
							context.path?.startsWith("/oauth2/callback")
						),
					handler: createAuthMiddleware(async (ctx) => {
						const location = ctx.context.responseHeaders?.get("location");
						if (!location) return;
						const rewritten = await rewriteExchangeRedirect(
							location,
							ctx.context.newSession?.session.id ?? null,
						);
						if (rewritten) ctx.setHeader("location", rewritten);
					}),
				},
			],
		},
		endpoints: {
			mobileExchange: createAuthEndpoint(
				EXCHANGE_PATH,
				{ method: "POST", body: exchangeBody },
				async (ctx) => {
					const token = await redeemExchangeCode(
						ctx.body.code,
						ctx.body.verifier,
					);
					if (!token) throw refused();
					return ctx.json({ token });
				},
			),
		},
		// An unauthenticated endpoint with a secret in the body. A code has 256
		// bits, so a guess cannot succeed; the limit keeps the table reads down.
		rateLimit: [
			{
				pathMatcher: (path) => path === EXCHANGE_PATH,
				window: 60,
				max: 20,
			},
		],
	}) satisfies BetterAuthPlugin;
