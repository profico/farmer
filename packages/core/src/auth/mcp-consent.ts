import { APIError } from "better-auth/api";
import type { Verification } from "better-auth/types";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { oauthApplication, oauthConsent } from "../db/schema/auth";

/**
 * The person approves every MCP connection on a Farmer screen.
 *
 * better-auth's mcp plugin accepts dynamic client registration (RFC 7591) from
 * anybody, with any `redirect_uris`. It asks for consent only when the client
 * sends `prompt=consent`. Without the checks below, a stranger could register
 * a client with their own redirect and send a signed-in person the authorize
 * URL. The browser would deliver a code for that account to the stranger with
 * no prompt.
 *
 * Three checks in `hooks.before` (`./index.ts`) close it, one per endpoint:
 *
 * - `/mcp/authorize` always runs as `prompt=consent`, so the browser goes to
 *   `MCP_CONSENT_PAGE`. A signed-out request is saved in a cookie and replayed
 *   after sign-in.
 * - `/oauth2/consent` accepts a consent code only from the account that
 *   received it. better-auth checks that somebody is signed in, not who. A
 *   leaked consent code could otherwise be approved by the stranger's session.
 * - `/mcp/token` refuses a code that still waits for consent, and a code for a
 *   client that this person never approved. The plugin checks neither.
 *
 * Every authorization shows the screen, also for a client that the person
 * approved before. `oauthConsent` records the approval but does not skip the
 * screen: it is the one place where the person sees where their access goes.
 */

/** better-auth's paths, without the `/api/auth` base. */
export const MCP_AUTHORIZE_PATH = "/mcp/authorize";
export const MCP_TOKEN_PATH = "/mcp/token";
export const OAUTH_CONSENT_PATH = "/oauth2/consent";

/** The web app's consent screen (`apps/web/src/routes/mcp-consent.tsx`). */
export const MCP_CONSENT_PAGE = "/mcp-consent";

/** The signed cookie better-auth keeps the pending consent code in. */
export const CONSENT_COOKIE = "oidc_consent_prompt";

/** `URL#hostname` as the WHATWG parser writes a loopback host. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A long client name is the client's own text; the screen needs a line. */
const MAX_CLIENT_NAME = 80;

/** What better-auth's mcp plugin stores for an authorization code (and for a
 *  consent code, which is the same row before the person decides). Only the
 *  fields read here. */
const storedCode = z.object({
	clientId: z.string(),
	userId: z.string(),
	redirectURI: z.string(),
	requireConsent: z.boolean(),
});
type StoredCode = z.infer<typeof storedCode>;

/** The one lookup this needs from better-auth's internal adapter, which
 *  applies the configured identifier storage the same way the plugin does. */
export type CodeStore = {
	findVerificationValue: (identifier: string) => Promise<Verification | null>;
};

type CodeLookup =
	| { state: "missing" }
	| { state: "unreadable" }
	| { state: "found"; code: StoredCode };

const decode = (value: string): StoredCode | null => {
	try {
		const parsed = storedCode.safeParse(JSON.parse(value));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
};

const lookUp = async (store: CodeStore, code: string): Promise<CodeLookup> => {
	const row = await store.findVerificationValue(code);
	if (!row || row.expiresAt < new Date()) return { state: "missing" };
	const decoded = decode(row.value);
	return decoded ? { state: "found", code: decoded } : { state: "unreadable" };
};

/**
 * A token request read exactly the way the plugin's handler reads it, so this
 * check sees the same code the handler would spend and turns away nothing the
 * handler would take. A refresh is `grant_type === "refresh_token"` and
 * nothing else; a code is any truthy value, spent as `code.toString()`, so a
 * `null` or `""` (which JSON serializers write for an absent field) is no code
 * at all, and `["abc"]` is the code `abc`. A body that is not an object fails
 * the parse, and the handler refuses it before it reads a code.
 */
export const mcpTokenRequest = z
	.object({
		grant_type: z.unknown().optional(),
		code: z.unknown().optional(),
		refresh_token: z.unknown().optional(),
	})
	.transform(({ grant_type, code, refresh_token }) => ({
		refresh: grant_type === "refresh_token",
		code: code ? String(code) : null,
		refreshToken: refresh_token ? String(refresh_token) : null,
	}));

/** The one field of a consent request this check reads. */
export const oauthConsentRequest = z.object({
	consent_code: z.string().nullish(),
});

const consentRequired = () =>
	new APIError("UNAUTHORIZED", {
		error: "invalid_grant",
		error_description: "The person has not approved this connection in Farmer.",
	});

/**
 * Refuse to spend a code the person has not approved. `/mcp/token` only; a
 * refresh or a request with no code is left to the endpoint, which answers it
 * the same way as before.
 */
export const assertCodeConsented = async (
	store: CodeStore,
	request: z.infer<typeof mcpTokenRequest>,
) => {
	if (request.refresh || !request.code) return;
	const found = await lookUp(store, request.code);
	// An unknown or expired code: the endpoint answers `invalid_grant` itself.
	if (found.state === "missing") return;
	if (found.state === "unreadable" || found.code.requireConsent) {
		throw consentRequired();
	}
	const approved = await db.query.oauthConsent.findFirst({
		columns: { id: true },
		where: and(
			eq(oauthConsent.clientId, found.code.clientId),
			eq(oauthConsent.userId, found.code.userId),
			eq(oauthConsent.consentGiven, true),
		),
	});
	if (!approved) throw consentRequired();
};

/**
 * Refuse a consent decision from any account but the one the request was made
 * for. `/oauth2/consent` only. With no code, or an unknown one, the endpoint
 * answers as before.
 */
export const assertConsentCodeOwner = async (
	store: CodeStore,
	consentCode: string | null,
	userId: string,
) => {
	if (!consentCode) return;
	const found = await lookUp(store, consentCode);
	if (found.state === "missing") return;
	if (found.state === "unreadable" || found.code.userId !== userId) {
		throw new APIError("FORBIDDEN", {
			error: "access_denied",
			message: "This connection request belongs to another account.",
		});
	}
};

/** What the consent screen shows. */
export type McpConsentRequest = {
	/** The name the client registered with. Its own words, not verified. */
	clientName: string | null;
	/** Where the access goes: the redirect's scheme and host. */
	destination: string;
	/** The redirect is a loopback address, so an app on this computer. */
	local: boolean;
};

/** The redirect as a person should read it: scheme and host, or the whole
 *  URI for one with no host (`myapp:callback`). */
const describeRedirect = (redirectURI: string) => {
	if (!URL.canParse(redirectURI)) {
		return { destination: redirectURI, local: false };
	}
	const url = new URL(redirectURI);
	const local =
		(url.protocol === "http:" || url.protocol === "https:") &&
		LOOPBACK_HOSTS.has(url.hostname);
	return {
		destination: url.host ? `${url.protocol}//${url.host}` : url.href,
		local,
	};
};

/**
 * The pending request behind a consent code, for the account it was issued
 * to. Null for a code that is unknown, expired, already decided, or somebody
 * else's — the screen says the same thing for all four.
 */
export const consentRequestFor = async (
	store: CodeStore,
	userId: string,
	consentCode: string,
): Promise<McpConsentRequest | null> => {
	const found = await lookUp(store, consentCode);
	if (found.state !== "found") return null;
	const { code } = found;
	if (!code.requireConsent || code.userId !== userId) return null;
	const client = await db.query.oauthApplication.findFirst({
		columns: { name: true },
		where: eq(oauthApplication.clientId, code.clientId),
	});
	if (!client) return null;
	return {
		clientName: client.name?.trim().slice(0, MAX_CLIENT_NAME) || null,
		...describeRedirect(code.redirectURI),
	};
};
