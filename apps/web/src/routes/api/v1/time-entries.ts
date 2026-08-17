import { createFileRoute } from "@tanstack/react-router";
import { resolveApiOrgContext } from "#/server/auth.ts";

export const Route = createFileRoute("/api/v1/time-entries")({
	server: {
		handlers: {
			// Validated with the SAME schema the server function uses
			// (`listTimeEntriesRangeInput`), not a local regex. This handler used to
			// check the date shape by hand and hand `from`/`to` straight to
			// `listRange`, which skipped the 62-day ceiling the schema carries — so
			// `?from=1970-01-01&to=2999-12-31` was a full-table scan any authenticated
			// caller could ask for. One schema, every call site; if the ceiling moves,
			// it moves here too.
			GET: async ({ request }) => {
				const ctx = await resolveApiOrgContext(request);
				if (!ctx) {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}

				const { timeEntriesService } = await import("@farmer/core/services");
				const { listTimeEntriesRangeInput } = await import(
					"@farmer/core/schema"
				);
				const { orgTimezone } = await import("@farmer/core/lib/org-time");
				const { dayKeyInTz } = await import("@farmer/core/lib/time");

				// Both params are optional and default to today, so the defaulting has
				// to happen before validation rather than after — otherwise "neither
				// supplied" fails the schema instead of meaning "today".
				const url = new URL(request.url);
				const tz = await orgTimezone(ctx.organizationId);
				const today = dayKeyInTz(new Date(), tz);
				const parsed = listTimeEntriesRangeInput.safeParse({
					from: url.searchParams.get("from") ?? today,
					to: url.searchParams.get("to") ?? today,
				});
				if (!parsed.success) {
					return Response.json(
						{
							error: "Invalid range",
							issues: parsed.error.issues.map((i) => ({
								path: i.path.join("."),
								message: i.message,
							})),
						},
						{ status: 400 },
					);
				}

				const entries = await timeEntriesService.listRange(ctx, parsed.data);
				return Response.json(entries);
			},
		},
	},
});
