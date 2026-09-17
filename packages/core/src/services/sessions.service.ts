import { and, desc, eq, gt } from "drizzle-orm";

import { CLI_USER_AGENT_PREFIX } from "../api/errors";
import { db } from "../db";
import { session } from "../db/schema/auth";
import type { Ctx } from "./types";

/**
 * Preferences → Signed-in devices: the caller's own sessions, and a way to end
 * one.
 *
 * It exists for the CLI. `farmer login` holds an ordinary better-auth session
 * (the device flow's token IS `session.token`), and it lives in a keyring or a
 * config file on some laptop for as long as the session does. Without this, a
 * person who lost that laptop had no way to end it short of asking an operator
 * to delete a database row.
 *
 * **Sessions belong to a user, not to an organization** — one sign-in reaches
 * every workspace the person is in. The functions still take a `Ctx`, and read
 * only `ctx.userId` from it. That is the service layer's rule (tenancy and
 * identity are parameters, never ambient), and it keeps the caller's identity
 * coming from the same place as every other service: the web boundary's
 * membership-checked Ctx, not a user id a handler fished out of somewhere else.
 * `organizationId` is deliberately ignored — filtering sessions by it would hide
 * a CLI session from the workspace that did not happen to be active.
 */

export type SessionKind = "cli" | "browser";

/** One row of the list. Never the token: the token is the credential, and a
 *  list that carried it would be a list of ways to become this person. */
export type MySession = {
	id: string;
	createdAt: Date;
	/** better-auth moves this when it renews the session (at most once a day,
	 *  `updateAge`), so it is "active by then", not "last request". */
	updatedAt: Date;
	expiresAt: Date;
	ipAddress: string | null;
	label: string;
	kind: SessionKind;
	/** The session this request was made with. */
	isCurrent: boolean;
};

/** Refused, rather than done: ending the session you are using is signing out,
 *  and the web app already has a control for that which also clears the
 *  cookie and leaves the page. Doing it from here would leave the page on
 *  screen with a dead session behind it. */
export class CurrentSessionRevokeError extends Error {
	constructor() {
		super("That is the session you are using now. Sign out instead to end it.");
		this.name = "CurrentSessionRevokeError";
	}
}

const BROWSERS: [RegExp, string][] = [
	// Order matters: Edge and Opera also say "Chrome", Chrome also says
	// "Safari", and every iOS browser is Safari underneath but names itself.
	[/\bEdg(?:e|A|iOS)?\//, "Edge"],
	[/\bOPR\/|\bOpera\b/, "Opera"],
	[/\bFirefox\/|\bFxiOS\//, "Firefox"],
	// Headless Chrome (automation, link previews) sends "HeadlessChrome/", which
	// has no word boundary before "Chrome".
	[/\b(?:Headless)?Chrome\/|\bCriOS\//, "Chrome"],
	[/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
	// iPadOS reports "Mac OS X" as well, and Android reports "Linux".
	[/\biPhone\b|\biPad\b|\biPod\b/, "iOS"],
	[/\bAndroid\b/, "Android"],
	[/\bCrOS\b/, "ChromeOS"],
	[/\bWindows\b/, "Windows"],
	[/\bMacintosh\b|\bMac OS X\b/, "macOS"],
	[/\bLinux\b/, "Linux"],
];

const firstMatch = (table: [RegExp, string][], text: string): string | null =>
	table.find(([pattern]) => pattern.test(text))?.[1] ?? null;

/**
 * A short, human name for the thing that holds a session.
 *
 * Presentation only, and allowed to be wrong: a User-Agent is whatever the
 * client chose to send. Nothing decides access from it. A CLI session is
 * recognised by `CLI_USER_AGENT_PREFIX` (`farmer-cli/<version>`, with the
 * platform after it when the binary sends one); anything else is read as a
 * browser, and a browser this does not recognise is still a browser row, just
 * a vaguer one.
 */
export type SessionDevice = { kind: SessionKind; label: string };

export const describeUserAgent = (userAgent: string | null): SessionDevice => {
	const ua = userAgent?.trim() ?? "";

	if (ua.startsWith(CLI_USER_AGENT_PREFIX)) {
		// "farmer-cli/0.1.0 (linux; x64)" or "farmer-cli/0.1.0 linux-x64": the
		// version is the first token and the rest, if any, is the platform.
		const rest = ua.slice(CLI_USER_AGENT_PREFIX.length);

		const platform = rest
			.replace(/^\S*/, "")
			.replace(/[()]/g, "")
			.replace(/\s*;\s*/g, " ")
			.trim();

		return {
			kind: "cli",
			label: platform ? `Farmer CLI (${platform})` : "Farmer CLI",
		};
	}

	const browser = firstMatch(BROWSERS, ua);
	const system = firstMatch(SYSTEMS, ua);

	const label =
		browser && system
			? `${browser} on ${system}`
			: (browser ?? system ?? "Unknown browser");

	return { kind: "browser", label };
};

export const sessionsService = {
	/**
	 * The caller's sessions that can still be used, the current one first and
	 * then the most recently renewed.
	 *
	 * An expired row is left out rather than shown as "expired": better-auth
	 * refuses it already and deletes it on its own schedule, so it is not a
	 * device anybody needs to act on.
	 */
	listMine: async (
		ctx: Ctx,
		currentSessionId: string,
	): Promise<MySession[]> => {
		const rows = await db
			.select({
				id: session.id,
				createdAt: session.createdAt,
				updatedAt: session.updatedAt,
				expiresAt: session.expiresAt,
				ipAddress: session.ipAddress,
				userAgent: session.userAgent,
			})
			.from(session)
			.where(
				and(eq(session.userId, ctx.userId), gt(session.expiresAt, new Date())),
			)
			.orderBy(desc(session.updatedAt));

		return rows
			.map(({ userAgent, ...row }) => ({
				...row,
				...describeUserAgent(userAgent),
				isCurrent: row.id === currentSessionId,
			}))
			.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
	},

	/**
	 * End one of the caller's own sessions.
	 *
	 * The delete names both the id and `ctx.userId`, so another person's session
	 * id deletes nothing. "Not yours" and "no such session" are the same answer
	 * (`revoked: false`) on purpose: telling them apart would let anyone probe
	 * whether a session id exists.
	 *
	 * The current session is refused with `CurrentSessionRevokeError` — see the
	 * class for why that is signing out rather than revoking.
	 *
	 * Deleting the row is the whole revocation. No cookie cache or secondary
	 * storage is configured (`packages/core/src/auth/index.ts`), so the next
	 * request with that token finds no session: a browser is sent to sign in,
	 * and the CLI gets a 401 and deletes its stored token.
	 */
	revoke: async (
		ctx: Ctx,
		sessionId: string,
		currentSessionId: string,
	): Promise<{ revoked: boolean }> => {
		if (sessionId === currentSessionId) throw new CurrentSessionRevokeError();

		const deleted = await db
			.delete(session)
			.where(and(eq(session.id, sessionId), eq(session.userId, ctx.userId)))
			.returning({ id: session.id });

		return { revoked: deleted.length > 0 };
	},
};
