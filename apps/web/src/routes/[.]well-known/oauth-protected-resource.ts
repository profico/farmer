import { createFileRoute } from "@tanstack/react-router";

/**
 * RFC 9728 protected resource metadata — the document the `WWW-Authenticate`
 * header on a 401 from `/api/mcp/<slug>` points at, and therefore the first
 * thing a client reads on its way into the OAuth flow.
 *
 * ONE document, at the origin, for every organization. better-auth publishes
 * `resource` as the origin and `authorization_servers: [origin]`, and the MCP
 * TypeScript SDK checks the server URL against that `resource` as a path
 * PREFIX — so an origin-level answer covers every `/api/mcp/<slug>` at once.
 * A document per organization would be a per-tenant authorization server,
 * which is not what the slug in that URL means: the token is a person's, and
 * which workspace they are asking about is a question the path answers.
 *
 * See the sibling file for why this is a route and why the directory is
 * spelled `[.]well-known`.
 */
export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const [{ auth }, { oAuthProtectedResourceMetadata }] =
					await Promise.all([
						import("@farmer/core/auth"),
						import("better-auth/plugins"),
					]);

				return oAuthProtectedResourceMetadata(auth)(request);
			},
		},
	},
});
