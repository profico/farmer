import { toApiMobileDevice } from "@farmer/core/api";
import { registerMobileDeviceInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { userWriteRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/me/devices` — the mobile app registers its phone for native
 * push (ADR 0006, `docs/domains/mobile.md`). An upsert on the installation
 * id, so the app can send it each time it comes to the foreground.
 *
 * Only with a sign-in session token. The row belongs to that session and
 * goes when the session goes; an API token has no session, so it gets a 403.
 */
export const Route = createFileRoute("/api/v1/me/devices/")({
	server: {
		handlers: {
			POST: userWriteRoute({
				input: registerMobileDeviceInput,
				run: async (caller, input) => {
					const { mobileDevicesService } =
						await import("@farmer/core/services");
					const credential = caller.credential;
					const device = await mobileDevicesService.register(
						{ userId: caller.userId },
						input,
						{
							sessionToken:
								credential?.kind === "session" ? credential.token : null,
						},
					);
					return toApiMobileDevice(device);
				},
			}),
		},
	},
});
