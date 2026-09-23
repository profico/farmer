// Minimal Slack Web API client. Only a handful of methods are needed, so this is
// a thin fetch wrapper rather than a dependency on @slack/web-api.

import { externalFetch } from "./http";
import type { JsonValue } from "./json";

const SLACK_API = "https://slack.com/api";

/** Everything the bot needs: DM people (chat:write, im:write) and resolve them
 *  from their work email (users:read + users:read.email). Deliberately nothing
 *  else — the bot never reads a message. */
export const SLACK_BOT_SCOPES = [
	"chat:write",
	"im:write",
	"users:read",
	"users:read.email",
] as const;

/**
 * The one redirect URI, derived rather than passed around: Slack compares it
 * byte-for-byte between the authorize leg and the token exchange, so the two
 * call sites computing it independently is a bug waiting to happen. This must
 * also be listed verbatim under "Redirect URLs" in the Slack app config.
 */
export const slackRedirectUri = (): string => {
	const base = process.env.BETTER_AUTH_URL;
	if (!base) throw new Error("BETTER_AUTH_URL not configured");
	return new URL("/api/slack/callback", base).toString();
};

/** Escape text for Slack's mrkdwn. `&`, `<` and `>` are the three characters
 *  Slack reads as markup, so a client called "Smith & <Co>" otherwise breaks
 *  the message or turns into a link. */
export const slackEscape = (text: string): string =>
	text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** A mrkdwn link to an app-relative path, or null when the app's own origin
 *  is not configured. `BETTER_AUTH_URL` is that origin: it is what
 *  `slackRedirectUri` builds on too. A missing link costs the reader a click;
 *  it is not worth failing a send over. */
export const slackLink = (path: string, label: string): string | null => {
	const base = process.env.BETTER_AUTH_URL;
	if (!base) return null;
	return `<${new URL(path, base).toString()}|${slackEscape(label)}>`;
};

type SlackResponse<T> = { ok: true } & T;
type SlackError = { ok: false; error: string };

/** What a `chat.postMessage` came to. `refused` is an answer about the
 *  recipient that no retry today can change (`RECIPIENT_REFUSALS`);
 *  `revoked` is an answer about the bot token (`CREDENTIAL_REFUSALS`), so no
 *  send to anybody can go out until an admin installs Slack again; `failed`
 *  is anything else — a rate limit, a 5xx, a timeout — which a later try may
 *  get through. */
export type SlackPostResult = "sent" | "refused" | "revoked" | "failed";

/** Slack's error codes that say the recipient cannot get a DM: a deactivated
 *  or deleted account, an archived channel, or a user id this workspace does
 *  not know (`channel_not_found` is what a DM to one answers). None changes
 *  within the day, so the reminder job gives up on the person at once rather
 *  than trying three times. */
const RECIPIENT_REFUSALS = new Set([
	"cannot_dm_bot",
	"channel_not_found",
	"is_archived",
	"user_disabled",
	"user_not_found",
]);

/** Slack's error codes that say the credential is dead, not the person:
 *  `account_inactive` is the answer for a bot token whose workspace or
 *  installing user was deleted, beside the revoked and invalid token codes.
 *  Every send fails the same way, so reading one as "this person cannot be
 *  reached" made a revoked token look like an organization nobody could
 *  reach, with nothing counted and Settings still "Connected". */
const CREDENTIAL_REFUSALS = new Set([
	"account_inactive",
	"invalid_auth",
	"not_authed",
	"token_revoked",
]);

/**
 * Every call is form-encoded, not JSON.
 *
 * Slack's docs list `application/json` among the accepted content types for
 * methods it does not actually accept it for — `users.lookupByEmail` answers a
 * JSON body with `invalid_arguments`, which read as "that person isn't in the
 * workspace" all the way up to a Settings screen reporting "matched 0 people".
 * Form encoding is accepted by *every* Web API method, so it's the encoding
 * that can't be wrong per-method. Non-string values (chat.postMessage `blocks`)
 * are JSON-stringified, which is how Slack documents passing them in a form
 * body.
 */
/** What Slack's form encoding accepts. Strings go on the wire as-is; anything
 *  else is JSON-stringified, which is how Slack documents passing structured
 *  arguments like `chat.postMessage`'s `blocks`. */
type SlackFormBody = Record<string, string | JsonValue | undefined>;

const call = async <T>(
	botToken: string,
	method: string,
	body: SlackFormBody,
): Promise<SlackResponse<T> | SlackError> => {
	const form = new URLSearchParams();
	for (const [key, value] of Object.entries(body)) {
		if (value === undefined) continue;
		// Discriminating a declared union, not narrowing an unparsed value: a
		// string is already form-encodable and everything else is JSON, which is
		// exactly how Slack documents passing `blocks`.
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- see above
		form.set(key, typeof value === "string" ? value : JSON.stringify(value));
	}
	const response = await externalFetch(`${SLACK_API}/${method}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${botToken}`,
			"Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
		},
		body: form.toString(),
	});
	if (!response.ok) {
		return { ok: false, error: `http_${response.status}` };
	}
	// SAFETY: an HTTP failure already returned a SlackError above, so this is a
	// 200 — and Slack answers 200 for its own failures too, which is exactly why
	// the type is a union the caller must discriminate on `ok` before reading.
	return (await response.json()) as SlackResponse<T> | SlackError;
};

export type SlackAuth = {
	team_id: string;
	team: string;
	user_id: string;
};

export type SlackOAuthResult = {
	access_token: string;
	bot_user_id: string;
	team: { id: string; name?: string };
};

export const slackClient = {
	/**
	 * Exchange the `code` from Slack's OAuth v2 redirect for a bot token.
	 *
	 * Unlike every other call here this one authenticates with the app's
	 * client_id/client_secret rather than a bot token — it's the call that
	 * *produces* the bot token — and Slack requires form encoding for it, not
	 * JSON.
	 */
	exchangeOAuthCode: async (code: string): Promise<SlackOAuthResult> => {
		const clientId = process.env.SLACK_CLIENT_ID;
		const clientSecret = process.env.SLACK_CLIENT_SECRET;
		if (!clientId || !clientSecret) {
			throw new Error("SLACK_CLIENT_ID / SLACK_CLIENT_SECRET not configured");
		}

		const response = await externalFetch(`${SLACK_API}/oauth.v2.access`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				code,
				redirect_uri: slackRedirectUri(),
			}),
		});
		// SAFETY: oauth.v2.access answers 200 for both outcomes and signals which one
		// with `ok`, so the union is the contract and the check below is the narrowing.
		const result = (await response.json()) as
			| ({ ok: true } & SlackOAuthResult)
			| SlackError;
		if (!result.ok) {
			throw new Error(`Slack rejected the install: ${result.error}`);
		}
		return result;
	},

	/** Verifies a bot token and returns the workspace it belongs to. */
	authTest: async (botToken: string) => {
		const result = await call<SlackAuth>(botToken, "auth.test", {});
		if (!result.ok)
			throw new Error(`Slack rejected the token: ${result.error}`);
		return result;
	},

	/** Resolve a person's Slack user id from their email. Returns null when they
	 *  aren't in the workspace — that person simply receives no nudges, which is
	 *  not an error worth failing a whole reminder run over. Logs why, because
	 *  the caller only counts matches: "matched 0 people" reads the same whether
	 *  the token is missing a scope or nobody's address is in the workspace, and
	 *  without this line the difference is only visible by hand-curling Slack.
	 *  `users_not_found` alone is not logged: it is the expected answer for
	 *  everyone outside the workspace. */
	lookupUserByEmail: async (
		botToken: string,
		email: string,
	): Promise<string | null> => {
		const result = await call<{ user: { id: string } }>(
			botToken,
			"users.lookupByEmail",
			{ email },
		);
		if (!result.ok) {
			// Not being in the workspace is an answer, not a failure: a re-match of
			// a large organization used to log one error per such person.
			if (result.error !== "users_not_found") {
				console.error(
					`[slack] lookupByEmail(${email}) failed: ${result.error}`,
				);
			}
			return null;
		}
		return result.user.id;
	},

	/** Post a DM. `channel` may be a user id — Slack opens the IM for us. */
	postMessage: async (
		botToken: string,
		channel: string,
		text: string,
		/** Block Kit blocks. JSON by definition — Slack's own wire format. */
		blocks?: JsonValue[],
	): Promise<SlackPostResult> => {
		// `blocks` only when there are some: Slack reads an empty `blocks` key as
		// an instruction to render nothing, which silently drops the message body.
		const result = await call<{ ts: string }>(
			botToken,
			"chat.postMessage",
			blocks?.length ? { channel, text, blocks } : { channel, text },
		);
		if (!result.ok) {
			console.error(`[slack] postMessage failed: ${result.error}`);
			if (CREDENTIAL_REFUSALS.has(result.error)) return "revoked";
			return RECIPIENT_REFUSALS.has(result.error) ? "refused" : "failed";
		}
		return "sent";
	},
};
