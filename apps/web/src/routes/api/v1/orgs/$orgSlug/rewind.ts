import { type ApiRewind, toApiRewind } from "@farmer/core/api";
import { rewindInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { typedQuery } from "#/server/api-query.ts";
import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/rewind?year=2026` — the caller's own year in
 * review. A year that has not opened yet is refused with `invalid_input`.
 *
 * `asOf` reads the year as of another day, as the web page allows. Only a
 * development server takes it, by the same gate as the password sign-in. In
 * production the clock is the clock, and `asOf` has no effect.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/rewind")({
	server: {
		handlers: {
			GET: apiRoute({
				input: rewindInput,
				raw: typedQuery({ numbers: ["year"] }),
				run: async (ctx, input): Promise<ApiRewind> => {
					const [{ rewindService }, { isDevAuthEnabled }] = await Promise.all([
						import("@farmer/core/services"),
						import("@farmer/core/lib/dev-auth"),
					]);
					const now =
						input.asOf && isDevAuthEnabled()
							? new Date(`${input.asOf}T12:00:00Z`)
							: undefined;
					return toApiRewind(
						await rewindService.mine(ctx, { year: input.year }, { now }),
					);
				},
			}),
		},
	},
});
