import {
	type ApiDayAssembly,
	type ApiDayAssemblyResult,
	toApiDayAssembly,
	toApiDayAssemblyResult,
} from "@farmer/core/api";
import {
	applyDayAssemblyInput,
	suggestDayAssemblyInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { typedQuery } from "#/server/api-query.ts";
import { apiRoute } from "#/server/api-route.ts";

/**
 * `/api/v1/orgs/$orgSlug/day-assembly` — "Assemble my day" on the Day view.
 *
 * GET proposes entries for one day from the person's calendar, their GitHub
 * work and the rest of the day, and writes nothing. POST makes the entries
 * that the person kept, with the 24-hour limit for the whole set first. Each
 * entry after that is best effort, as in the web app.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/day-assembly")({
	server: {
		handlers: {
			GET: apiRoute({
				input: suggestDayAssemblyInput,
				raw: typedQuery({ booleans: ["includeDismissed"] }),
				run: async (ctx, input): Promise<ApiDayAssembly> => {
					const { dayAssemblyService } = await import("@farmer/core/services");
					return toApiDayAssembly(await dayAssemblyService.suggest(ctx, input));
				},
			}),
			POST: apiRoute({
				input: applyDayAssemblyInput,
				run: async (ctx, input): Promise<ApiDayAssemblyResult> => {
					const { dayAssemblyService } = await import("@farmer/core/services");
					return toApiDayAssemblyResult(
						await dayAssemblyService.apply(ctx, input),
					);
				},
			}),
		},
	},
});
