import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { auth } = await import("@farmer/core/auth");
				return auth.handler(request);
			},
			POST: async ({ request }) => {
				const { auth } = await import("@farmer/core/auth");
				return auth.handler(request);
			},
		},
	},
});
