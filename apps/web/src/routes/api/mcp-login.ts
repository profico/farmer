import { createFileRoute } from "@tanstack/react-router";

/**
 * The better-auth mcp plugin sends an unauthenticated
 * `/api/auth/mcp/authorize` request to `${loginPage}?${originalQuery}`. The
 * query holds the OAuth parameters (`client_id`, `redirect_uri`, `state` and
 * more).
 *
 * `/login` cannot take them. Its search schema names five keys and Zod strips
 * the rest. The return trip then has no `client_id` and redirects to the login
 * page again, an infinite loop with no error. Do not widen that schema: it
 * puts OAuth names on the sign-in screen, and the next new parameter breaks it
 * again.
 *
 * So this route keeps the query as an opaque string and carries it in the
 * `redirect` parameter of `/login`:
 *
 *     /api/mcp-login?<oauth query>
 *       -> /login?redirect=<encoded "/api/auth/mcp/authorize?<oauth query>">
 *
 * `/login` accepts only a same-site absolute path as `redirect` and rejects
 * `//evil.com`. A person who is already signed in never reaches this route.
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
				const target = `/login?redirect=${encodeURIComponent(authorize)}`;
				return Response.redirect(new URL(target, url.origin).toString(), 302);
			},
		},
	},
});
