import { z } from "zod";

import { TASK_GROUPS } from "../lib/task-taxonomy";

export const taskGroupEnum = z.enum(TASK_GROUPS);
export type TaskGroupValue = z.infer<typeof taskGroupEnum>;

export const createTaskInput = z.object({
	name: z.string().trim().min(1, "Name is required").max(80),
	// Absent = "general"; the service applies the default so callers that
	// predate groups keep working.
	group: taskGroupEnum.optional(),
	color: z.string().optional(),
	description: z.string().max(500).optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskInput>;

export const updateTaskInput = z.object({
	taskId: z.uuid(),
	name: z.string().trim().min(1, "Name is required").max(80).optional(),
	group: taskGroupEnum.optional(),
	color: z.string().optional(),
	description: z.string().max(500).optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskInput>;

export const archiveTaskInput = z.uuid();
export type ArchiveTaskInput = z.infer<typeof archiveTaskInput>;

export const taskIdInput = z.uuid();
export type TaskIdInput = z.infer<typeof taskIdInput>;
