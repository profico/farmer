import { type ApiMeta, MIN_CLI_VERSION } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

/**
 * `GET /api/v1/meta` — the one unauthenticated CLI route, and the first thing
 * `farmer login` asks a URL.
 *
 * It answers even when `CLI_ENABLED=false`, with `cliEnabled: false`, where
 * every other CLI route answers 404. That is the difference between "this is a
 * Farmer server that does not run the CLI" and "this is not a Farmer server",
 * and the person typing the URL needs to be told which mistake they made.
 *
 * No rate limit and no credential: it reads no database and says nothing about
 * anybody.
 */
export const Route = createFileRoute("/api/v1/meta")({
	server: {
		handlers: {
			GET: async () => {
				const { isCliEnabled } = await import("@farmer/core/lib/cli-flag");
				const meta: ApiMeta = {
					app: "farmer",
					cliEnabled: isCliEnabled(),
					minCliVersion: MIN_CLI_VERSION,
				};
				return Response.json(meta, {
					headers: { "Cache-Control": "no-store" },
				});
			},
		},
	},
});
