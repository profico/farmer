import { z } from "zod";

export const projectTypeEnum = z.enum([
	"product_team",
	"fixed_scope",
	"hourly",
	"maintenance",
	"internal",
]);
export type ProjectTypeValue = z.infer<typeof projectTypeEnum>;

export const projectRoleEnum = z.enum(["member", "team_lead", "pm"]);
export type ProjectRoleValue = z.infer<typeof projectRoleEnum>;

// Money is display-only and never computed against, so it stays a decimal string
// matching the `numeric` column rather than becoming a number. Empty ⇒ null.
const money = z
	.string()
	.trim()
	.regex(/^\d+(\.\d{1,2})?$/, "Expected an amount like 1500 or 1500.00")
	.optional()
	.nullable();

const baseProject = {
	name: z.string().trim().min(1, "Name is required").max(120),
	clientId: z.uuid(),
	code: z.string().trim().max(16).optional(),
	type: projectTypeEnum,
	// An emoji. Loose on purpose — a flag or a family is several code points —
	// and short enough that nothing but an emoji fits. Null clears it.
	icon: z.string().trim().min(1).max(16).optional().nullable(),
	// Fixed Scope only: the hour budget is the ONLY budget burn is computed on.
	budgetHours: z.coerce.number().positive().max(100_000).optional().nullable(),
	// Fixed Scope only, display-only context beside the hour figures.
	budgetAmount: money,
	// Hourly only, display-only, visible to that project's PMs and Admins.
	hourlyPrice: money,
};

// Type-specific config is enforced here rather than in the UI so the REST route
// and the server function get the same guarantees: a Maintenance project has no
// config at all in v1, and an Internal project is always billed to nobody.
const typeConfigRefinement = <
	T extends {
		type?: ProjectTypeValue;
		budgetHours?: number | null;
		budgetAmount?: string | null;
		hourlyPrice?: string | null;
	},
>(
	data: T,
	ctx: z.RefinementCtx,
) => {
	// A patch that leaves `type` alone must also leave the type-specific config
	// alone: without knowing the type there is nothing to validate the budget
	// against, and silently accepting it is how a rename would come to carry an
	// hour budget onto a Maintenance project.
	if (data.type === undefined) {
		for (const field of [
			"budgetHours",
			"budgetAmount",
			"hourlyPrice",
		] as const) {
			if (data[field] != null) {
				ctx.addIssue({
					code: "custom",
					path: [field],
					message: "Send the project type alongside its budget or price",
				});
			}
		}
		return;
	}
	if (data.type !== "fixed_scope") {
		if (data.budgetHours != null) {
			ctx.addIssue({
				code: "custom",
				path: ["budgetHours"],
				message: "Only Fixed Scope projects carry an hour budget",
			});
		}
		if (data.budgetAmount != null) {
			ctx.addIssue({
				code: "custom",
				path: ["budgetAmount"],
				message: "Only Fixed Scope projects carry a budget amount",
			});
		}
	}
	if (data.type !== "hourly" && data.hourlyPrice != null) {
		ctx.addIssue({
			code: "custom",
			path: ["hourlyPrice"],
			message: "Only Hourly projects carry an hourly price",
		});
	}
};

export const createProjectInput = z
	.object(baseProject)
	.superRefine(typeConfigRefinement);
export type CreateProjectInput = z.infer<typeof createProjectInput>;

// A partial patch, matching updateTaskInput: an edit form that only owns the
// name and the icon must not have to round-trip the client and budgets just
// to avoid nulling them. Every key is optional and an omitted one is left
// untouched by the service.
export const updateProjectInput = z
	.object({
		projectId: z.uuid(),
		name: baseProject.name.optional(),
		clientId: baseProject.clientId.optional(),
		code: baseProject.code,
		type: baseProject.type.optional(),
		icon: baseProject.icon,
		budgetHours: baseProject.budgetHours,
		budgetAmount: baseProject.budgetAmount,
		hourlyPrice: baseProject.hourlyPrice,
	})
	.superRefine(typeConfigRefinement);
export type UpdateProjectInput = z.infer<typeof updateProjectInput>;

export const projectIdInput = z.uuid();
export type ProjectIdInput = z.infer<typeof projectIdInput>;

export const listProjectMembersInput = z.uuid();
export type ListProjectMembersInput = z.infer<typeof listProjectMembersInput>;

export const assignProjectMemberInput = z.object({
	projectId: z.uuid(),
	userId: z.string().min(1),
	role: projectRoleEnum.default("member"),
});
export type AssignProjectMemberInput = z.infer<typeof assignProjectMemberInput>;

export const removeProjectMemberInput = z.object({
	projectId: z.uuid(),
	userId: z.string().min(1),
});
export type RemoveProjectMemberInput = z.infer<typeof removeProjectMemberInput>;
