import {
	archiveEntryTypeInput,
	createEntryTypeInput,
	updateEntryTypeInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgAdminMiddleware, orgMiddleware } from "./auth";

// Site + this org's own types. Project-scoped types are already available on
// each project from `listProjects` (see project.entryTypes), so the client
// merges those in locally instead of re-querying per project selection.
export const listAvailableEntryTypes = createServerFn({
	method: "GET",
})
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { entryTypesService } = await import("@farmer/core/services");
		return entryTypesService.listAvailable(context.ctx);
	});

export const listManagedEntryTypes = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { entryTypesService } = await import("@farmer/core/services");
		return entryTypesService.listManaged(context.ctx);
	});

export const createEntryType = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(createEntryTypeInput)
	.handler(async ({ data, context }) => {
		const { entryTypesService } = await import("@farmer/core/services");
		return entryTypesService.create(context.ctx, data);
	});

export const updateEntryType = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(updateEntryTypeInput)
	.handler(async ({ data, context }) => {
		const { entryTypesService } = await import("@farmer/core/services");
		return entryTypesService.update(context.ctx, data);
	});

export const archiveEntryType = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(archiveEntryTypeInput)
	.handler(async ({ data: entryTypeId, context }) => {
		const { entryTypesService } = await import("@farmer/core/services");
		return entryTypesService.archive(context.ctx, entryTypeId);
	});
