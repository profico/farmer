import { createFileRoute } from "@tanstack/react-router";
import { resolveApiOrgContext } from "#/server/auth.ts";

export const Route = createFileRoute("/api/v1/projects")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const ctx = await resolveApiOrgContext(request);
				if (!ctx) {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}
				const { projectsService } = await import("@farmer/core/services");
				const projects = await projectsService.list(ctx);
				return Response.json(projects);
			},
		},
	},
});
