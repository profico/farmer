import {
	createTimeEntryInput,
	deleteTimeEntryInput,
	listTimeEntriesRangeInput,
	updateTimeEntryDescriptionInput,
	updateTimeEntryInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgMiddleware } from "./auth";

export const listTimeEntriesRange = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(listTimeEntriesRangeInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.listRange(context.ctx, data);
	});

export const createTimeEntry = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(createTimeEntryInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.create(context.ctx, data);
	});

export const updateTimeEntry = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(updateTimeEntryInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.update(context.ctx, data);
	});

export const updateTimeEntryDescription = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(updateTimeEntryDescriptionInput)
	.handler(async ({ data, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		return timeEntriesService.updateDescription(context.ctx, data);
	});

export const deleteTimeEntry = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(deleteTimeEntryInput)
	.handler(async ({ data: timeEntryId, context }) => {
		const { timeEntriesService } = await import("@farmer/core/services");
		await timeEntriesService.remove(context.ctx, timeEntryId);
	});
