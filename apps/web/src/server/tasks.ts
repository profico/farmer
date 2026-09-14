import {
	archiveTaskInput,
	createTaskInput,
	projectIdInput,
	taskIdInput,
	updateTaskInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgAdminMiddleware, orgMiddleware } from "./auth";

// The tasks one entry form may offer: with a project, every live task of the
// org plus the built-ins; without one, the absence tasks and built-ins only. Passing no project id returns
// only the absence tasks, which is the right answer for "logging without a
// project".
export const listTasksForProject = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(projectIdInput.optional())
	.handler(async ({ data: projectId, context }) => {
		const { tasksService } = await import("@farmer/core/services");
		return tasksService.listForProject(context.ctx, projectId);
	});

// Every task the caller could pick anywhere, for report filters where the
// picker isn't scoped to one project.
export const listSelectableTasks = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { tasksService } = await import("@farmer/core/services");
		return tasksService.listSelectable(context.ctx);
	});

export const listManagedTasks = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { tasksService } = await import("@farmer/core/services");
		return tasksService.listManaged(context.ctx);
	});

export const createTask = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(createTaskInput)
	.handler(async ({ data, context }) => {
		const { tasksService } = await import("@farmer/core/services");
		return tasksService.create(context.ctx, data);
	});

export const updateTask = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(updateTaskInput)
	.handler(async ({ data, context }) => {
		const { tasksService } = await import("@farmer/core/services");
		return tasksService.update(context.ctx, data);
	});

export const archiveTask = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(archiveTaskInput)
	.handler(async ({ data: taskId, context }) => {
		const { tasksService } = await import("@farmer/core/services");
		return tasksService.archive(context.ctx, taskId);
	});

// The way back. Restoring keeps the task's id, so the entries already on it stay
// attached — which is the whole reason to offer this instead of letting an admin
// create a same-named replacement.
export const unarchiveTask = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(taskIdInput)
	.handler(async ({ data: taskId, context }) => {
		const { tasksService } = await import("@farmer/core/services");
		return tasksService.unarchive(context.ctx, taskId);
	});
