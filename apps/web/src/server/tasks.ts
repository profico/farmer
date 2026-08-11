import {
	archiveTaskInput,
	createTaskInput,
	projectIdInput,
	setProjectTasksInput,
	setTaskProjectsInput,
	taskIdInput,
	updateTaskInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgAdminMiddleware, orgMiddleware } from "./auth";

// The tasks a given project has cherry-picked, plus the two absence tasks —
// exactly the option list for one entry form. Passing no project id returns
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

// Which of the global tasks this project offers. Team Lead and up, enforced in
// the service — not admin-only, so `orgMiddleware` is correct here.
export const setProjectTasks = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(setProjectTasksInput)
	.handler(async ({ data, context }) => {
		const { tasksService } = await import("@farmer/core/services");
		return tasksService.setProjectTasks(
			context.ctx,
			data.projectId,
			data.taskIds,
		);
	});

// The same join read and written from the task's side. Admin-only, because it
// spans every project in the org rather than one the caller leads.
export const listProjectsForTask = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(taskIdInput)
	.handler(async ({ data: taskId, context }) => {
		const { tasksService } = await import("@farmer/core/services");
		return tasksService.listProjectsForTask(context.ctx, taskId);
	});

export const setTaskProjects = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(setTaskProjectsInput)
	.handler(async ({ data, context }) => {
		const { tasksService } = await import("@farmer/core/services");
		return tasksService.setTaskProjects(
			context.ctx,
			data.taskId,
			data.projectIds,
		);
	});
