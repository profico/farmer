import { createHash } from "node:crypto";

import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { z } from "zod";

import {
	CONFIRM_PATH,
	mintExchangeCode,
	peekConfirmation,
	takeConfirmation,
} from "./mobile-exchange";

/**
 * The confirmation page of the mobile sign-in (ADR 0005, RFC 8252 §8.6).
 *
 * A person can start an app sign-in and send the proxy link to somebody
 * else. Without this page, the other person would sign in and the browser
 * would send a code for their session straight to `farmer://`.
 *
 * The callback sends the browser here first. The page names the account and
 * the server, and asks the person to continue. Only a POST from the same
 * session, with the one-time id of the page, makes the code and sends the
 * browser to the app:
 *
 *  - The id is 32 random bytes. The server keeps only its hash, with the
 *    session id, the challenge and the `farmer://` link, for
 *    `CONFIRMATION_TTL_MS`.
 *  - The POST spends the id first (one delete), so a used id, or an id sent
 *    with another session or with no session, fails and is burned.
 *  - A GET shows the page and changes nothing.
 *  - The page cannot be framed (`frame-ancestors 'none'`, `X-Frame-Options`),
 *    and it has no script: only the person's tap submits the form.
 *
 * This page is a consent step, not a binding. A person who continues sends
 * the code to the app that owns `farmer://` on the phone.
 */

const CONFIRM_STYLE =
	"body{font-family:system-ui,sans-serif;margin:0;padding:24px;line-height:1.5;color:#1c1c1c;background:#fafafa}" +
	"main{max-width:28rem;margin:0 auto}h1{font-size:1.25rem}" +
	"strong{overflow-wrap:anywhere}form{display:flex;gap:12px;margin-top:24px}" +
	"button{flex:1;font:inherit;padding:12px;border-radius:8px;border:1px solid #888;background:#fff;color:#1c1c1c}" +
	"button[value=continue]{background:#1c1c1c;color:#fff;border-color:#1c1c1c}";

const STYLE_HASH = createHash("sha256").update(CONFIRM_STYLE).digest("base64");

const PAGE_HEADERS = {
	"Content-Type": "text/html; charset=utf-8",
	// No `form-action`: browsers apply it to the redirect after the POST, and
	// that redirect goes to `farmer://`.
	"Content-Security-Policy": `default-src 'none'; style-src 'sha256-${STYLE_HASH}'; base-uri 'none'; frame-ancestors 'none'`,
	"X-Frame-Options": "DENY",
	"Cache-Control": "no-store",
	// Not `no-referrer`: with it, the POST carries `Origin: null`, and the
	// origin check of better-auth refuses it.
	"Referrer-Policy": "same-origin",
	"X-Content-Type-Options": "nosniff",
};

const escapeHtml = (text: string) =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

const page = (body: string, status: number) =>
	new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8">` +
			`<meta name="viewport" content="width=device-width, initial-scale=1">` +
			`<title>Farmer sign-in</title><style>${CONFIRM_STYLE}</style></head>` +
			`<body><main>${body}</main></body></html>`,
		{ status, headers: PAGE_HEADERS },
	);

const invalidPage = () =>
	page(
		"<h1>This sign-in is not valid</h1>" +
			"<p>The link expired, or it was used. Start the sign-in again in the Farmer app.</p>",
		400,
	);

export const confirmPage = (input: {
	id: string;
	email: string;
	serverOrigin: string;
	action: string;
}) =>
	page(
		"<h1>Sign in to the Farmer app?</h1>" +
			`<p>Sign in to the Farmer app on this phone as <strong>${escapeHtml(input.email)}</strong> ` +
			`at <strong>${escapeHtml(input.serverOrigin)}</strong>?</p>` +
			"<p>Continue only if you started this sign-in in the Farmer app on this phone. " +
			"If you did not, select Cancel.</p>" +
			`<form method="post" action="${escapeHtml(input.action)}">` +
			`<input type="hidden" name="id" value="${escapeHtml(input.id)}">` +
			'<button type="submit" name="action" value="cancel">Cancel</button>' +
			'<button type="submit" name="action" value="continue">Continue</button>' +
			"</form>",
		200,
	);

const appRedirect = (link: URL) =>
	new Response(null, {
		status: 302,
		headers: { Location: link.toString(), "Cache-Control": "no-store" },
	});

const confirmQuery = z.object({ id: z.string().min(1).max(128) });

const confirmBody = z.object({
	id: z.string().min(1).max(128),
	action: z.enum(["continue", "cancel"]),
});

/**
 * The plugin. Its endpoints read the session cookie that the provider
 * callback set in the same browser.
 */
export const mobileConfirm = () =>
	({
		id: "mobile-confirm",
		endpoints: {
			mobileConfirmPage: createAuthEndpoint(
				CONFIRM_PATH,
				{ method: "GET", query: confirmQuery },
				async (ctx) => {
					const session = await getSessionFromCtx(ctx);
					const pending = await peekConfirmation(ctx.query.id);
					if (!session || pending?.sessionId !== session.session.id) {
						return invalidPage();
					}
					const base = new URL(ctx.context.baseURL);
					return confirmPage({
						id: ctx.query.id,
						email: session.user.email,
						serverOrigin: base.origin,
						action: `${base.pathname}${CONFIRM_PATH}`,
					});
				},
			),
			mobileConfirm: createAuthEndpoint(
				CONFIRM_PATH,
				{
					method: "POST",
					body: confirmBody,
					// The page's form posts as a browser does.
					metadata: {
						allowedMediaTypes: ["application/x-www-form-urlencoded"],
					},
				},
				async (ctx) => {
					// Spent before any check, so an id works once in every case.
					const pending = await takeConfirmation(ctx.body.id);
					const session = await getSessionFromCtx(ctx);
					if (!session || pending?.sessionId !== session.session.id) {
						return invalidPage();
					}
					const link = new URL(pending.link);
					if (ctx.body.action === "cancel") {
						await ctx.context.internalAdapter.deleteSession(
							session.session.token,
						);
						link.searchParams.set("error", "access_denied");
						return appRedirect(link);
					}
					link.searchParams.set(
						"code",
						await mintExchangeCode(pending.sessionId, pending.challenge),
					);
					return appRedirect(link);
				},
			),
		},
	}) satisfies BetterAuthPlugin;
