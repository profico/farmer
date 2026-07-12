import { z } from "zod";

export const createEntryTypeInput = z
	.object({
		scope: z.enum(["organization", "project"]),
		projectId: z.uuid().optional(),
		name: z.string().min(1, "Name is required"),
		color: z.string().optional(),
		description: z.string().optional(),
		billableDefault: z.boolean().default(true),
	})
	.refine((data) => (data.scope === "project" ? !!data.projectId : true), {
		message: "Project is required for a project-scoped type",
		path: ["projectId"],
	});
export type CreateEntryTypeInput = z.infer<typeof createEntryTypeInput>;

export const updateEntryTypeInput = z.object({
	entryTypeId: z.uuid(),
	name: z.string().min(1, "Name is required").optional(),
	color: z.string().optional(),
	description: z.string().optional(),
	billableDefault: z.boolean().optional(),
});
export type UpdateEntryTypeInput = z.infer<typeof updateEntryTypeInput>;

export const archiveEntryTypeInput = z.uuid();
export type ArchiveEntryTypeInput = z.infer<typeof archiveEntryTypeInput>;
