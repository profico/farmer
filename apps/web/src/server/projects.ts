import {
	assignProjectMemberInput,
	createProjectInput,
	listProjectMembersInput,
	projectIdInput,
	removeProjectMemberInput,
	updateProjectInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgMiddleware } from "./auth";

// None of these are admin-gated at the middleware any more. Project management
// is a per-project role (Team Lead adds people, PM sees money, both can exist
// without org admin), so authorization is resolved inside projectsService
// against the caller's assignment — an org-wide admin check here would lock out
// exactly the people the §4 matrix is meant to empower.

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

export const getProject = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(projectIdInput)
	.handler(async ({ data: projectId, context }) => {
		const { projectsService } = await import("@farmer/core/services");

		return projectsService.get(context.ctx, projectId);
	});

// The strip at the top of a project's page. Team Lead and up, in the service.
export const getProjectOverview = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(projectIdInput)
	.handler(async ({ data: projectId, context }) => {
		const { projectsService } = await import("@farmer/core/services");

		return projectsService.overview(context.ctx, projectId);
	});

export const listProjectMembers = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(listProjectMembersInput)
	.handler(async ({ data: projectId, context }) => {
		const { projectsService } = await import("@farmer/core/services");

		return projectsService.listMembers(context.ctx, projectId);
	});

// Org members not yet on the project — the "add someone" picker.
export const listAssignableMembers = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(projectIdInput)
	.handler(async ({ data: projectId, context }) => {
		const { projectsService } = await import("@farmer/core/services");

		return projectsService.listAssignable(context.ctx, projectId);
	});

export const assignProjectMember = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(assignProjectMemberInput)
	.handler(async ({ data, context }) => {
		const { projectsService } = await import("@farmer/core/services");

		return projectsService.assignMember(context.ctx, data);
	});

export const removeProjectMember = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(removeProjectMemberInput)
	.handler(async ({ data, context }) => {
		const { projectsService } = await import("@farmer/core/services");

		return projectsService.removeMember(context.ctx, data);
	});

export const createProject = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(createProjectInput)
	.handler(async ({ data, context }) => {
		const { projectsService } = await import("@farmer/core/services");
		const project = await projectsService.create(context.ctx, data);
		const { getPostHogClient } = await import("../lib/posthog-server");
		const posthog = getPostHogClient();

		if (posthog) {
			posthog.capture({
				distinctId: context.ctx.userId,
				event: "project_created",
				properties: {
					organization_id: context.ctx.organizationId,
					project_id: project.id,
					project_type: data.type,
					has_budget: Boolean(data.budgetHours || data.budgetAmount),
				},
			});
			await posthog.flush();
		}

		return project;
	});

export const updateProject = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(updateProjectInput)
	.handler(async ({ data, context }) => {
		const { projectsService } = await import("@farmer/core/services");

		return projectsService.update(context.ctx, data);
	});

export const archiveProject = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(projectIdInput)
	.handler(async ({ data: projectId, context }) => {
		const { projectsService } = await import("@farmer/core/services");

		return projectsService.archive(context.ctx, projectId);
	});

export const unarchiveProject = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(projectIdInput)
	.handler(async ({ data: projectId, context }) => {
		const { projectsService } = await import("@farmer/core/services");

		return projectsService.unarchive(context.ctx, projectId);
	});

export const listProjectTasks = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(projectIdInput)
	.handler(async ({ data: projectId, context }) => {
		const { projectsService } = await import("@farmer/core/services");

		return projectsService.listTasks(context.ctx, projectId);
	});
