import { type ApiProjectDetail, toApiProjectDetail } from "@farmer/core/api";
import { projectIdInput, updateProjectInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { bodyWithPath } from "#/server/api-query.ts";
import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

const byId = z.object({ projectId: projectIdInput });

/**
 * `/api/v1/orgs/$orgSlug/projects/$id` — one project, and its settings.
 *
 * Reading needs the same right as logging time on it: an admin, an
 * assignment, or a project open to the organization. A change is a patch: the
 * fields that are not sent stay as they are. The budget, the hourly price and
 * the code need a PM or an admin (`assertCanManageProject`), and the type must
 * come with its budget or price, as on the settings page.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/projects/$id/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: byId,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					projectId: params.id,
				}),
				run: async (ctx, { projectId }): Promise<ApiProjectDetail> => {
					const { projectsService } = await import("@farmer/core/services");
					return toApiProjectDetail(await projectsService.get(ctx, projectId));
				},
			}),
			PATCH: apiRoute({
				input: updateProjectInput,
				raw: ({ params, body }: ApiRequest<OrgRowParams>) =>
					bodyWithPath(body, { projectId: params.id }),
				run: async (ctx, input): Promise<ApiProjectDetail> => {
					const { projectsService } = await import("@farmer/core/services");
					return toApiProjectDetail(await projectsService.update(ctx, input));
				},
			}),
		},
	},
});
