import {
	archiveProjectIdInput,
	assignProjectMemberInput,
	createProjectInput,
	listProjectMembersInput,
	removeProjectMemberInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgAdminMiddleware, orgMiddleware } from "./auth";

export const listProjects = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { projectsService } = await import("@farmer/core/services");
		return projectsService.list(context.ctx);
	});

// Projects the caller may log time against (feeds the time-entry picker).
export const listMyProjects = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { projectsService } = await import("@farmer/core/services");
		return projectsService.listMine(context.ctx);
	});

export const listProjectMembers = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(listProjectMembersInput)
	.handler(async ({ data: projectId, context }) => {
		const { projectsService } = await import("@farmer/core/services");
		return projectsService.listMembers(context.ctx, projectId);
	});

export const assignProjectMember = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(assignProjectMemberInput)
	.handler(async ({ data, context }) => {
		const { projectsService } = await import("@farmer/core/services");
		return projectsService.assignMember(context.ctx, data);
	});

export const removeProjectMember = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(removeProjectMemberInput)
	.handler(async ({ data, context }) => {
		const { projectsService } = await import("@farmer/core/services");
		return projectsService.removeMember(context.ctx, data);
	});

export const createProject = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(createProjectInput)
	.handler(async ({ data, context }) => {
		const { projectsService } = await import("@farmer/core/services");
		return projectsService.create(context.ctx, data);
	});

export const archiveProject = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(archiveProjectIdInput)
	.handler(async ({ data: projectId, context }) => {
		const { projectsService } = await import("@farmer/core/services");
		return projectsService.archive(context.ctx, projectId);
	});
