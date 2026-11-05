import type { ApiIntegrations } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { integrationsOf } from "#/server/api-integrations.ts";
import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/integrations` — the caller's own GitHub and
 * Google Calendar connections and their switches, as on Settings →
 * Integrations.
 *
 * Connecting an account is an OAuth flow in the browser, and no server
 * function makes its URL, so the API has no route for it. The app opens the
 * web app's Integrations page for that. A GitHub or Google outage is
 * `unreachable`, not an error, as on the web page.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/integrations/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: (ctx): Promise<ApiIntegrations> => integrationsOf(ctx),
			}),
		},
	},
});
