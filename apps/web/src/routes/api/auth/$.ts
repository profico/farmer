import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

/** better-auth's device authorization endpoints: `/device` (verify), and
 *  `/device/code`, `/device/token`, `/device/approve`, `/device/deny`. */
const DEVICE_PATH = /^\/api\/auth\/device(?:\/|$)/;

/**
 * Every better-auth endpoint, with one exception decided here.
 *
 * The device flow is the CLI's sign-in and nothing else's, so `CLI_ENABLED=false`
 * takes it away: a 404, the same answer `/api/v1/orgs/*` gives, rather than a
 * flow that hands out a token the API then refuses. The plugin stays mounted
 * either way (see `packages/core/src/auth/index.ts`), which keeps the schema
 * and the flag independent — flipping the variable needs no migration.
 */
const handle = async (request: Request) => {
	if (DEVICE_PATH.test(new URL(request.url).pathname)) {
		const { isCliEnabled } = await import("@farmer/core/lib/cli-flag");
		if (!isCliEnabled()) {
			return Response.json({ error: "Not found" }, { status: 404 });
		}
	}
	const { auth } = await import("@farmer/core/auth");
	return auth.handler(request);
};

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: ({ request }) => handle(request),
			POST: ({ request }) => handle(request),
		},
	},
});
