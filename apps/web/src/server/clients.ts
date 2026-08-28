import {
	clientIdInput,
	createClientInput,
	updateClientInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgMiddleware } from "./auth";

// Plain orgMiddleware throughout, not orgAdminMiddleware: creating clients is a
// PM/Team-Lead capability too (PRD 3.3), and the service resolves that from the
// caller's project assignments — an org-wide admin gate here would lock them out.

export const listClients = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { clientsService } = await import("@farmer/core/services");
		return clientsService.list(context.ctx);
	});

/** Archived ones included — the management screen needs to show and restore them. */
export const listAllClients = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { clientsService } = await import("@farmer/core/services");
		return clientsService.listAll(context.ctx);
	});

export const createClient = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(createClientInput)
	.handler(async ({ data, context }) => {
		const { clientsService } = await import("@farmer/core/services");
		return clientsService.create(context.ctx, data);
	});

export const updateClient = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(updateClientInput)
	.handler(async ({ data, context }) => {
		const { clientsService } = await import("@farmer/core/services");
		return clientsService.update(context.ctx, data);
	});

export const archiveClient = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(clientIdInput)
	.handler(async ({ data: clientId, context }) => {
		const { clientsService } = await import("@farmer/core/services");
		return clientsService.archive(context.ctx, clientId);
	});

export const unarchiveClient = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(clientIdInput)
	.handler(async ({ data: clientId, context }) => {
		const { clientsService } = await import("@farmer/core/services");
		return clientsService.unarchive(context.ctx, clientId);
	});
