import { createFileRoute } from "@tanstack/react-router";

/**
 * The entire sign-in surface.
 *
 * Google is the only identity the app accepts (see packages/core/src/auth),
 * so there is nothing to choose and no credentials to type — "log in" is a
 * redirect, not a page. This route asks better-auth for the Google authorize
 * URL and 302s to it, carrying the OAuth state cookie better-auth just minted
 * on the same response.
 *
 * A server route rather than a client-side `authClient.signIn.social()` call
 * because the bounce then costs no JavaScript: an unauthenticated document
 * request reaches Google without the app ever hydrating. `/login` exists only
 * to funnel router-level redirects (and Links) here and to render OAuth
 * errors — it never shows a form.
 */
export const Route = createFileRoute("/api/login")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);

				// Where the user lands once Google is done. `redirect` is attacker-
				// supplied in principle (it rides in a link), so only a same-site
				// absolute path is accepted — "//evil.com" is a protocol-relative URL,
				// not a path, which is why the second test is not redundant.
				const requested = url.searchParams.get("redirect");
				const target =
					requested?.startsWith("/") && !requested.startsWith("//")
						? requested
						: "/";
				// Invite context (org/orgSlug/role/email) rides along as query params
				// so an invited visitor lands on the same accept-invite screen the
				// email link would have taken them to, still knowing which org it is.
				const context = new URLSearchParams();
				for (const key of ["email", "org", "orgSlug", "role"]) {
					const value = url.searchParams.get(key);
					if (value) context.set(key, value);
				}
				const query = context.toString();
				const callbackURL = query
					? `${target}${target.includes("?") ? "&" : "?"}${query}`
					: target;

				const absolute = (path: string) => new URL(path, url.origin).toString();

				const { auth } = await import("@farmer/core/auth");

				// Already signed in — a stale /login link, or a second tab. Send them
				// where they were going rather than back through Google.
				const session = await auth.api.getSession({ headers: request.headers });
				if (session) return Response.redirect(absolute(callbackURL), 302);

				// `asResponse` is what makes this work: the endpoint returns 200 with
				// the authorize URL in its body and the OAuth state/PKCE cookie in its
				// headers, and that cookie has to reach the browser or the callback
				// leg fails. We re-shape it into a real 302, cookies intact.
				const response = await auth.api.signInSocial({
					body: {
						provider: "google",
						callbackURL,
						// Errors on the far side of the round-trip (most usefully the
						// invite-only gate) come back as /login?error=… , which is the one
						// case /login renders instead of redirecting.
						errorCallbackURL: "/login",
					},
					headers: request.headers,
					asResponse: true,
				});

				const location =
					response.headers.get("Location") ??
					((await response.json()) as { url?: string }).url;
				if (!location) {
					console.error("[login] no authorize URL from better-auth");
					return Response.redirect(
						absolute("/login?error=sign_in_unavailable"),
						302,
					);
				}

				const headers = new Headers({ Location: location });
				for (const cookie of response.headers.getSetCookie()) {
					headers.append("Set-Cookie", cookie);
				}
				return new Response(null, { status: 302, headers });
			},
		},
	},
});
