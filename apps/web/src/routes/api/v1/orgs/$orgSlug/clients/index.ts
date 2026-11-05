import { type ApiClient, toApiClient } from "@farmer/core/api";
import { createClientInput, listClientsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `/api/v1/orgs/$orgSlug/clients` — the organization's clients.
 *
 * Every member may read the list, as in the web app, where the project
 * pickers need it. `includeArchived=true` adds the archived ones for
 * Settings → Clients. Creating a client is open to an admin and to a PM or
 * team lead on any project, because a PM sets up the client of a new project;
 * `clientsService.create` checks that.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/clients/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: listClientsInput,
				run: async (ctx, input): Promise<ApiClient[]> => {
					const { clientsService } = await import("@farmer/core/services");
					const rows =
						input.includeArchived === "true"
							? await clientsService.listAll(ctx)
							: await clientsService.list(ctx);
					return rows.map(toApiClient);
				},
			}),
			POST: apiRoute({
				input: createClientInput,
				run: async (ctx, input): Promise<ApiClient> => {
					const { clientsService } = await import("@farmer/core/services");
					return toApiClient(await clientsService.create(ctx, input));
				},
			}),
		},
	},
});
