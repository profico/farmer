import { createFileRoute, redirect } from "@tanstack/react-router";

import { getHomeRedirect } from "#/server/config.ts";

// `/` is only a way into the app. The public site lives in `apps/site`.
export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const orgSlug = await getHomeRedirect();
		throw redirect({ to: "/$orgSlug", params: { orgSlug } });
	},
});
