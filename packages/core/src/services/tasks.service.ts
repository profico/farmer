import { and, asc, count, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { project, projectTask, task, timeEntry } from "../db/schema/domain";
import type { CreateTaskInput, UpdateTaskInput } from "../schema/tasks";
import { accessService } from "./access.service";
import type { Ctx } from "./types";

// The two built-in absence tasks. Site-scoped, seeded once, never archivable and
// never cherry-pickable onto a project: Vacation and Sick Leave carry no client
// and no project, and are logged by the person themselves (PRD 3.5).
export const VACATION_TASK_NAME = "Vacation";
export const SICK_LEAVE_TASK_NAME = "Sick Leave";
export const ABSENCE_TASK_NAMES = [
	VACATION_TASK_NAME,
	SICK_LEAVE_TASK_NAME,
] as const;

export type AbsenceKind = "vacation" | "sick";

export const tasksService = {
	/** The two built-in absence tasks, in a stable order. */
	listAbsenceTasks: async () => {
		const rows = await db.query.task.findMany({
			where: and(eq(task.isAbsence, true), isNull(task.archivedAt)),
			orderBy: asc(task.name),
		});
		return rows;
	},

	/** Set of absence task ids — the cheap membership test used all over the
	 *  reporting layer to split absence out of worked time. */
	absenceTaskIds: async (): Promise<Set<string>> => {
		const rows = await db.query.task.findMany({
			where: eq(task.isAbsence, true),
			columns: { id: true },
		});
		return new Set(rows.map((r) => r.id));
	},

	/** Tasks selectable when logging against a given project: strictly the
	 *  project's cherry-picked subset (PRD 3.5 — a project shows only its picked
	 *  tasks). With no project, the absence tasks are what's on offer. */
	listForProject: async (ctx: Ctx, projectId: string | undefined) => {
		if (!projectId) return tasksService.listAbsenceTasks();

		const rows = await db
			.select({
				id: task.id,
				name: task.name,
				color: task.color,
				description: task.description,
				isAbsence: task.isAbsence,
			})
			.from(projectTask)
			.innerJoin(task, eq(projectTask.taskId, task.id))
			.where(
				and(
					eq(projectTask.organizationId, ctx.organizationId),
					eq(projectTask.projectId, projectId),
					isNull(task.archivedAt),
				),
			)
			.orderBy(asc(task.name));
		return rows;
	},

	/** The whole global list this org may cherry-pick from: site built-ins that
	 *  aren't absence tasks, plus the org's own tasks. */
	listSelectable: async (ctx: Ctx) => {
		return db.query.task.findMany({
			where: and(
				isNull(task.archivedAt),
				eq(task.isAbsence, false),
				or(
					eq(task.scope, "site"),
					and(
						eq(task.scope, "organization"),
						eq(task.organizationId, ctx.organizationId),
					),
				),
			),
			orderBy: asc(task.name),
		});
	},

	/** Everything relevant to this org including archived, with usage counts, for
	 *  the Settings screen. Admin only. */
	listManaged: async (ctx: Ctx) => {
		await accessService.requireAdmin(ctx);

		const tasks = await db.query.task.findMany({
			where: or(
				eq(task.scope, "site"),
				eq(task.organizationId, ctx.organizationId),
			),
			orderBy: [asc(task.scope), asc(task.name)],
		});

		// How many of THIS org's entries reference each task — scoped to the org
		// even for shared site tasks, so the count reflects local usage rather than
		// every org on the platform.
		const counts = await db
			.select({ taskId: timeEntry.taskId, count: count() })
			.from(timeEntry)
			.where(eq(timeEntry.organizationId, ctx.organizationId))
			.groupBy(timeEntry.taskId);
		const countByTask = new Map(counts.map((c) => [c.taskId, c.count]));

		return tasks.map((t) => ({ ...t, entryCount: countByTask.get(t.id) ?? 0 }));
	},

	create: async (ctx: Ctx, input: CreateTaskInput) => {
		await accessService.requireAdmin(ctx);
		const [created] = await db
			.insert(task)
			.values({
				// There is deliberately no project scope: the taxonomy is strictly
				// global and projects cherry-pick from it.
				scope: "organization",
				organizationId: ctx.organizationId,
				name: input.name.trim(),
				color: input.color,
				description: input.description,
			})
			.returning();
		if (!created) throw new Error("Failed to create task");
		return created;
	},

	update: async (ctx: Ctx, input: UpdateTaskInput) => {
		await accessService.requireAdmin(ctx);
		const existing = await db.query.task.findFirst({
			where: and(
				eq(task.id, input.taskId),
				eq(task.organizationId, ctx.organizationId),
			),
		});
		if (!existing) throw new Error("Task not found");
		if (existing.scope === "site") {
			throw new Error("Built-in tasks cannot be edited");
		}

		const [updated] = await db
			.update(task)
			.set({
				...(input.name !== undefined ? { name: input.name.trim() } : {}),
				...(input.color !== undefined ? { color: input.color } : {}),
				...(input.description !== undefined
					? { description: input.description }
					: {}),
				updatedAt: new Date(),
			})
			.where(eq(task.id, input.taskId))
			.returning();
		return updated;
	},

	archive: async (ctx: Ctx, taskId: string) => {
		await accessService.requireAdmin(ctx);
		const existing = await db.query.task.findFirst({
			where: and(
				eq(task.id, taskId),
				eq(task.organizationId, ctx.organizationId),
			),
		});
		if (!existing) throw new Error("Task not found");
		// Vacation and Sick Leave are built-ins and cannot be removed (PRD §8).
		if (existing.scope === "site" || existing.isAbsence) {
			throw new Error("Built-in tasks cannot be archived");
		}

		await db
			.update(task)
			.set({ archivedAt: new Date(), updatedAt: new Date() })
			.where(eq(task.id, taskId));
	},

	// ── Per-project cherry-picking ────────────────────────────────────────────

	/** Replace a project's picked task subset wholesale. Absence tasks are
	 *  rejected: they carry no project by definition. */
	setProjectTasks: async (ctx: Ctx, projectId: string, taskIds: string[]) => {
		const access = await accessService.resolve(ctx);
		access.assertCanManageProjectMembers(projectId);

		const owned = await db.query.project.findFirst({
			where: and(
				eq(project.id, projectId),
				eq(project.organizationId, ctx.organizationId),
			),
			columns: { id: true },
		});
		if (!owned) throw new Error("Project not found");

		const unique = [...new Set(taskIds)];
		if (unique.length > 0) {
			// Every id must be a live, non-absence task this org may use. Checked in
			// the query (not by comparing in JS after the fact) so a caller can't
			// smuggle in another org's task id.
			const valid = await db.query.task.findMany({
				where: and(
					inArray(task.id, unique),
					isNull(task.archivedAt),
					eq(task.isAbsence, false),
					or(
						eq(task.scope, "site"),
						and(
							eq(task.scope, "organization"),
							eq(task.organizationId, ctx.organizationId),
						),
					),
				),
				columns: { id: true },
			});
			if (valid.length !== unique.length) {
				throw new Error("One or more tasks are not available to this project");
			}
		}

		await db.transaction(async (tx) => {
			await tx
				.delete(projectTask)
				.where(
					and(
						eq(projectTask.organizationId, ctx.organizationId),
						eq(projectTask.projectId, projectId),
					),
				);
			if (unique.length > 0) {
				await tx.insert(projectTask).values(
					unique.map((taskId) => ({
						organizationId: ctx.organizationId,
						projectId,
						taskId,
					})),
				);
			}
		});
	},
};
