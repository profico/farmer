import { z } from "zod";

export const createProjectInput = z.object({
	name: z.string().min(1, "Name is required"),
	clientId: z.uuid().optional(),
	code: z.string().optional(),
	billable: z.boolean().default(true),
	billableRate: z.string().optional(),
	currency: z.string().default("USD"),
	color: z.string().optional(),
	firstTaskName: z.string().optional(),
	budgetHours: z.coerce.number().positive().optional(),
	budgetAmount: z.string().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInput>;

export const archiveProjectInput = z.object({
	projectId: z.uuid(),
});
export type ArchiveProjectInput = z.infer<typeof archiveProjectInput>;

// Matches the bare-string shape the client actually sends
// (`archiveProject({ data: projectId })`), unlike archiveProjectInput above.
export const archiveProjectIdInput = z.uuid();
export type ArchiveProjectIdInput = z.infer<typeof archiveProjectIdInput>;

// Rates are decimal strings to match the `numeric` columns; empty ⇒ null.
const rate = z.string().optional().nullable();

export const listProjectMembersInput = z.uuid();
export type ListProjectMembersInput = z.infer<typeof listProjectMembersInput>;

export const assignProjectMemberInput = z.object({
	projectId: z.uuid(),
	userId: z.string(),
	isVacationApprover: z.boolean().default(false),
	billableRate: rate,
	costRate: rate,
});
export type AssignProjectMemberInput = z.infer<typeof assignProjectMemberInput>;

export const removeProjectMemberInput = z.object({
	projectId: z.uuid(),
	userId: z.string(),
});
export type RemoveProjectMemberInput = z.infer<typeof removeProjectMemberInput>;
