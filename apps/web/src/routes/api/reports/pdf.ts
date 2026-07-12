import { utilizationRangeInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { resolveApiOrgContext } from "#/server/auth.ts";

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
				const { membersService, reportPdfService } = await import(
					"@farmer/core/services"
				);
				// Mirrors the reports page's admin gate — the PDF is the same data.
				const role = await membersService.getRole(ctx);
				if (role !== "owner" && role !== "admin") {
					return Response.json({ error: "Forbidden" }, { status: 403 });
				}

				const url = new URL(request.url);
				const parsed = utilizationRangeInput.safeParse({
					from: url.searchParams.get("from"),
					to: url.searchParams.get("to"),
				});
				if (!parsed.success) {
					return Response.json(
						{ error: "Expected ?from=yyyy-MM-dd&to=yyyy-MM-dd" },
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
