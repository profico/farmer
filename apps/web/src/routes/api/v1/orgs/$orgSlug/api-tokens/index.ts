import {
	type ApiPersonalToken,
	type ApiPersonalTokenCreated,
	toApiPersonalToken,
} from "@farmer/core/api";
import { createApiTokenInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT, requireSignIn } from "#/server/api-route.ts";

/**
 * `GET` and `POST /api/v1/orgs/$orgSlug/api-tokens` — Preferences → API
 * tokens. The tokens belong to the person, and the list is the same in every
 * workspace. The workspace in the path is the one a new token is bound to,
 * when the body says `workspace: "this"`.
 *
 * The POST answers the token once, as the web app shows it once. No other
 * route returns it. An API token is refused on both routes: see
 * `requireSignIn`.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/api-tokens/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx, _input, caller): Promise<ApiPersonalToken[]> => {
					await requireSignIn(caller.via);
					const { apiTokensService } = await import("@farmer/core/services");
					const tokens = await apiTokensService.listMine(ctx);
					return tokens.map(toApiPersonalToken);
				},
			}),
			POST: apiRoute({
				input: createApiTokenInput,
				run: async (ctx, input, caller): Promise<ApiPersonalTokenCreated> => {
					await requireSignIn(caller.via);
					const { apiTokensService } = await import("@farmer/core/services");
					const created = await apiTokensService.create(ctx, input);
					return {
						token: created.token,
						apiToken: toApiPersonalToken(created.apiToken),
					};
				},
			}),
		},
	},
});
