import { createFileRoute } from "@tanstack/react-router";

/**
 * One hop, and the reason it exists is the whole point of the file.
 *
 * better-auth's mcp plugin sends an unauthenticated `/api/auth/mcp/authorize`
 * request to `${loginPage}?${originalQuery}` — eight OAuth parameters
 * (`client_id`, `redirect_uri`, `response_type`, `scope`, `state`,
 * `code_challenge`, `code_challenge_method` and whatever else the client sent)
 * on a path that is supposed to sign the person in and send them back.
 *
 * `/login` cannot be that path. Its search schema names five keys and Zod
 * strips the rest, so the parameters would be gone by the time anything read
 * them, and the trip back to `/mcp/authorize` would arrive with no `client_id`
 * — which redirects to the login page again. It fails as an infinite loop, not
 * as an error. Widening that schema to eight OAuth parameters is the wrong fix:
 * it would put OAuth vocabulary on the app's own sign-in screen for a flow that
 * screen has nothing to do with, and the next parameter a client sends would
 * break it again the same silent way.
 *
 * So this route keeps the parameters as an opaque query string and puts them
 * where a whole URL is already carried safely:
 *
 *     /api/mcp-login?<oauth query>
 *       -> /api/login?redirect=<encoded "/api/auth/mcp/authorize?<oauth query>">
 *
 * `/api/login` already accepts only a same-site absolute path, already rejects
 * `//evil.com`, and already short-circuits straight to the destination when a
 * session exists — so a person already signed in never sees Google at all, and
 * one who is not comes back here through the callback with a cookie.
 */
export const Route = createFileRoute("/api/mcp-login")({
	server: {
		handlers: {
			GET: ({ request }) => {
				const url = new URL(request.url);
				// Rebuilt from `url.search` rather than from named keys: this route
				// knows that these are OAuth parameters and deliberately knows nothing
				// about WHICH, so a client sending one better-auth grows support for
				// later still arrives intact.
				const authorize = `/api/auth/mcp/authorize${url.search}`;
				const target = `/api/login?redirect=${encodeURIComponent(authorize)}`;

				return Response.redirect(new URL(target, url.origin).toString(), 302);
			},
		},
	},
});
