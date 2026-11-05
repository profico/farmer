import type { ApiCreatedOrganization } from "@farmer/core/api";
import { createOrganizationInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { userWriteRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/me/organizations` — a new workspace, owned by the caller, as
 * the org switcher's "New organization" makes it. The slug comes from the
 * name unless it is given, and a slug that is a page of the app moves to the
 * next free one. Refused in single-org mode (`organizationCreation` in
 * `/meta`). A sign-in session only: an API token gets 403.
 */
export const Route = createFileRoute("/api/v1/me/organizations")({
	server: {
		handlers: {
			POST: userWriteRoute({
				input: createOrganizationInput,
				run: async (caller, input): Promise<ApiCreatedOrganization> => {
					const headers = await caller.sessionHeaders();
					const { onboarding } = await import("@farmer/core/auth");
					return onboarding.createOrganization(headers, input);
				},
			}),
		},
	},
});
