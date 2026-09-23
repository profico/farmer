import {
	createOAuthProviderInput,
	updateOAuthProviderInput,
} from "@farmer/core/schema";
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
	/** Set after the person confirmed a change to the S3 endpoint or bucket
	 *  while objects are stored. Without it the service refuses that change. */
	confirmStorageMove: z.boolean().optional(),
});

/** Saved, or refused until the person confirms a storage move. The refusal
 *  is an answer rather than a thrown error, so the page can tell it from any
 *  other one without reading a message. */
export type UpdateInstanceSettingsResult =
	| { saved: true }
	| { saved: false; storedObjects: number };

export const updateInstanceSettings = createServerFn({ method: "POST" })
	.middleware([platformAdminMiddleware])
	.validator(updateInput)
	.handler(async ({ data, context }): Promise<UpdateInstanceSettingsResult> => {
		const { instanceSettingsService, StorageMoveNeedsConfirmationError } =
			await import("@farmer/core/services");
		try {
			await instanceSettingsService.update(
				context.session.user.id,
				data.changes,
				{ confirmStorageMove: data.confirmStorageMove },
			);
		} catch (error) {
			if (error instanceof StorageMoveNeedsConfirmationError) {
				return { saved: false, storedObjects: error.storedObjects };
			}
			throw error;
		}
		return { saved: true };
	});

export const listInstanceOAuthProviders = createServerFn({ method: "GET" })
	.middleware([platformAdminMiddleware])
	.handler(async () => {
		const { instanceSettingsService } = await import("@farmer/core/services");
		return instanceSettingsService.listOAuthProviders();
	});

export const createInstanceOAuthProvider = createServerFn({ method: "POST" })
	.middleware([platformAdminMiddleware])
	.validator(createOAuthProviderInput)
	.handler(async ({ data }) => {
		const { instanceSettingsService } = await import("@farmer/core/services");
		await instanceSettingsService.createOAuthProvider(data);
	});

export const updateInstanceOAuthProvider = createServerFn({ method: "POST" })
	.middleware([platformAdminMiddleware])
	.validator(updateOAuthProviderInput)
	.handler(async ({ data }) => {
		const { instanceSettingsService } = await import("@farmer/core/services");
		await instanceSettingsService.updateOAuthProvider(data);
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
