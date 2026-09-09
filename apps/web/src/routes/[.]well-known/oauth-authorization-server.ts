import { createFileRoute } from "@tanstack/react-router";

/**
 * RFC 8414 authorization server metadata, at the origin.
 *
 * better-auth mounts the same document under `/api/auth`, and that copy is not
 * the one clients read. The protected-resource document next door names the
 * authorization server as the ORIGIN, so a client's next fetch is
 * `<origin>/.well-known/oauth-authorization-server` — nothing rewrites that
 * path here, so it has to be a real route.
 *
 * A route rather than a case in `server.ts`, because `vite dev` never loads
 * `server.ts`: discovery would work in production and be missing in
 * development, which is the half of the flow hardest to debug from the client
 * side.
 *
 * The directory name is `[.]well-known`. A leading dot is a path separator in
 * TanStack Router's file names, so the square brackets are what make this
 * resolve to the literal path above rather than to `/well-known` under some
 * parent — check `routeTree.gen.ts` after touching it, since getting it wrong
 * is silent and just means discovery fails.
 *
 * `oAuthDiscoveryMetadata` returns the handler whole, permissive CORS included.
 */
export const Route = createFileRoute("/.well-known/oauth-authorization-server")(
	{
		server: {
			handlers: {
				GET: async ({ request }) => {
					const [{ auth }, { oAuthDiscoveryMetadata }] = await Promise.all([
						import("@farmer/core/auth"),
						import("better-auth/plugins"),
					]);
					return oAuthDiscoveryMetadata(auth)(request);
				},
			},
		},
	},
);
