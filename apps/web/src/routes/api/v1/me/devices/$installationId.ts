import { toApiMobileDevice } from "@farmer/core/api";
import type { JsonValue } from "@farmer/core/lib/json";
import {
	removeMobileDeviceInput,
	updateMobileDeviceInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { requireSignIn, userWriteRoute } from "#/server/api-route.ts";

type Params = { installationId: string };

/** A PATCH body: an object of JSON values. The schema after it checks the
 *  rest. A null stays, because null clears the Live Activity token. */
const patchBody = z.record(z.string(), z.json());

const withInstallationId = ({
	params,
	body,
}: {
	params: Params;
	body: JsonValue;
}): JsonValue => {
	const patch = patchBody.safeParse(body);
	if (!patch.success) return { installationId: params.installationId };
	// Last, so a body cannot point the patch at another installation.
	return { ...patch.data, installationId: params.installationId };
};

/**
 * `PATCH` and `DELETE /api/v1/me/devices/$installationId` — the app reports
 * a new Live Activity token, a change of the notification permission or a
 * new app version, or forgets the phone. The caller's own phones only. A
 * personal API token is refused, as it is on register.
 */
export const Route = createFileRoute("/api/v1/me/devices/$installationId")({
	server: {
		handlers: {
			PATCH: userWriteRoute({
				input: updateMobileDeviceInput,
				raw: withInstallationId,
				run: async (caller, input) => {
					await requireSignIn(caller.via);
					const { mobileDevicesService } =
						await import("@farmer/core/services");
					return toApiMobileDevice(
						await mobileDevicesService.update({ userId: caller.userId }, input),
					);
				},
			}),
			DELETE: userWriteRoute({
				input: removeMobileDeviceInput,
				raw: ({ params }: { params: Params; body: JsonValue }) => ({
					installationId: params.installationId,
				}),
				status: 204,
				run: async (caller, input) => {
					await requireSignIn(caller.via);
					const { mobileDevicesService } =
						await import("@farmer/core/services");
					await mobileDevicesService.remove({ userId: caller.userId }, input);
					return null;
				},
			}),
		},
	},
});
