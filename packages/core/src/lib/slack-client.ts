// Minimal Slack Web API client. Only a handful of methods are needed, so this is
// a thin fetch wrapper rather than a dependency on @slack/web-api.

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

type SlackResponse<T> = { ok: true } & T;
type SlackError = { ok: false; error: string };

const call = async <T>(
	botToken: string,
	method: string,
	body: Record<string, unknown>,
): Promise<SlackResponse<T> | SlackError> => {
	const response = await fetch(`${SLACK_API}/${method}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${botToken}`,
			"Content-Type": "application/json; charset=utf-8",
		},
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		return { ok: false, error: `http_${response.status}` };
	}
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

		const response = await fetch(`${SLACK_API}/oauth.v2.access`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				code,
				redirect_uri: slackRedirectUri(),
			}),
		});
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
		if (!result.ok) throw new Error(`Slack rejected the token: ${result.error}`);
		return result;
	},

	/** Resolve a person's Slack user id from their email. Returns null when they
	 *  aren't in the workspace — that person simply receives no nudges, which is
	 *  not an error worth failing a whole reminder run over. */
	lookupUserByEmail: async (
		botToken: string,
		email: string,
	): Promise<string | null> => {
		const result = await call<{ user: { id: string } }>(
			botToken,
			"users.lookupByEmail",
			{ email },
		);
		if (!result.ok) return null;
		return result.user.id;
	},

	/** Post a DM. `channel` may be a user id — Slack opens the IM for us. */
	postMessage: async (
		botToken: string,
		channel: string,
		text: string,
		blocks?: unknown[],
	): Promise<boolean> => {
		const result = await call<{ ts: string }>(botToken, "chat.postMessage", {
			channel,
			text,
			...(blocks ? { blocks } : {}),
		});
		if (!result.ok) {
			console.error(`[slack] postMessage failed: ${result.error}`);
			return false;
		}
		return true;
	},
};
