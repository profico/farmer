import { monthReportInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { resolveApiOrgContext } from "#/server/api-auth.ts";

// Session-cookie authed (not api/v1): this exists for the "Download PDF"
// button on the reports page, so a plain <a href> navigation downloads it.
export const Route = createFileRoute("/api/reports/pdf")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const ctx = await resolveApiOrgContext(request);
				if (!ctx) {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}
				const { accessService, AccessError, reportPdfService } =
					await import("@farmer/core/services");
				// The same gate every report service call makes, rather than this
				// route's own reading of the role — "owner or admin" was spelled out
				// here by hand, so a change to what Admin means would have missed it.
				try {
					await accessService.requireAdmin(ctx);
				} catch (error) {
					if (error instanceof AccessError) {
						return Response.json({ error: "Forbidden" }, { status: 403 });
					}
					throw error;
				}

				const url = new URL(request.url);
				const parsed = monthReportInput.safeParse({
					year: Number(url.searchParams.get("year")),
					month: Number(url.searchParams.get("month")),
				});
				if (!parsed.success) {
					return Response.json(
						{ error: "Expected ?year=2026&month=6" },
						{ status: 400 },
					);
				}

				const { pdf, filename } = await reportPdfService.exportOrgReport(
					ctx,
					parsed.data,
				);
				return new Response(new Uint8Array(pdf), {
					headers: {
						"Content-Type": "application/pdf",
						"Content-Disposition": `attachment; filename="${filename}"`,
					},
				});
			},
		},
	},
});
