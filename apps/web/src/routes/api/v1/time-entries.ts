import { createFileRoute } from "@tanstack/react-router";
import { resolveApiOrgContext } from "#/server/auth.ts";

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/api/v1/time-entries")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const ctx = await resolveApiOrgContext(request);
				if (!ctx) {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}

				const { timeEntriesService } = await import("@farmer/core/services");
				const { orgTimezone } = await import("@farmer/core/lib/org-time");
				const { dayKeyInTz } = await import("@farmer/core/lib/time");

				const url = new URL(request.url);
				const from = url.searchParams.get("from");
				const to = url.searchParams.get("to");
				if (
					(from && !dateKeyPattern.test(from)) ||
					(to && !dateKeyPattern.test(to))
				) {
					return Response.json(
						{ error: "from/to must be yyyy-MM-dd" },
						{ status: 400 },
					);
				}

				const tz = await orgTimezone(ctx.organizationId);
				const today = dayKeyInTz(new Date(), tz);
				const entries = await timeEntriesService.listRange(ctx, {
					from: from ?? today,
					to: to ?? today,
				});
				return Response.json(entries);
			},
		},
	},
});
