import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { platformAdminMiddleware } from "./auth";

/**
 * The Infrastructure pages' configuration reads and writes.
 *
 * Gated on `platformAdminMiddleware`, like `server/platform-admins.ts`: these
 * values belong to the deployment, so nothing here takes an organization. A
 * secret never comes back from any of these, only a hint.
 */

export const getInstanceSettings = createServerFn({ method: "GET" })
	.middleware([platformAdminMiddleware])
	.handler(async () => {
		const { instanceSettingsService } = await import("@farmer/core/services");
		return instanceSettingsService.view();
	});

/** A string sets the value, `null` clears it. A secret the form did not touch
 *  is left out of the map, so it keeps its stored value. */
const updateInput = z.object({
	changes: z.record(z.string(), z.string().max(20_000).nullable()),
});

export const updateInstanceSettings = createServerFn({ method: "POST" })
	.middleware([platformAdminMiddleware])
	.validator(updateInput)
	.handler(async ({ data, context }) => {
		const { instanceSettingsService } = await import("@farmer/core/services");
		await instanceSettingsService.update(context.session.user.id, data.changes);
		return instanceSettingsService.view();
	});

export const listInstanceOAuthProviders = createServerFn({ method: "GET" })
	.middleware([platformAdminMiddleware])
	.handler(async () => {
		const { instanceSettingsService } = await import("@farmer/core/services");
		return instanceSettingsService.listOAuthProviders();
	});

const providerFields = {
	name: z.string().trim().min(1).max(80),
	baseUrl: z.string().trim().min(1).max(500),
	clientId: z.string().trim().min(1).max(500),
	clientSecret: z.string().max(2_000).optional(),
	scopes: z.string().max(500),
	enabled: z.boolean(),
};

export const createInstanceOAuthProvider = createServerFn({ method: "POST" })
	.middleware([platformAdminMiddleware])
	.validator(
		z.object({
			providerId: z.string().trim().min(1).max(40),
			...providerFields,
		}),
	)
	.handler(async ({ data }) => {
		const { instanceSettingsService } = await import("@farmer/core/services");
		await instanceSettingsService.createOAuthProvider(data);
	});

export const updateInstanceOAuthProvider = createServerFn({ method: "POST" })
	.middleware([platformAdminMiddleware])
	.validator(z.object({ id: z.string().uuid(), ...providerFields }))
	.handler(async ({ data: { id, ...input } }) => {
		const { instanceSettingsService } = await import("@farmer/core/services");
		await instanceSettingsService.updateOAuthProvider(id, input);
	});

export const deleteInstanceOAuthProvider = createServerFn({ method: "POST" })
	.middleware([platformAdminMiddleware])
	.validator(z.object({ id: z.string().uuid() }))
	.handler(async ({ data }) => {
		const { instanceSettingsService } = await import("@farmer/core/services");
		await instanceSettingsService.deleteOAuthProvider(data.id);
	});

/** A put, get and delete round trip on a probe key, with the saved settings.
 *  Answers what failed rather than throwing, so the page can show it. */
export const testStorageConnection = createServerFn({ method: "POST" })
	.middleware([platformAdminMiddleware])
	.handler(async () => {
		const { instanceSettingsService } = await import("@farmer/core/services");
		return instanceSettingsService.testStorage();
	});

/** Send one message to the caller's own address with the saved settings. */
export const sendTestEmail = createServerFn({ method: "POST" })
	.middleware([platformAdminMiddleware])
	.handler(async ({ context }) => {
		const { instanceSettingsService } = await import("@farmer/core/services");
		return instanceSettingsService.testEmail(context.session.user.email);
	});
