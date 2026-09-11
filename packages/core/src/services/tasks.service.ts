import { and, asc, count, eq, inArray, isNull, or } from "drizzle-orm";

import { db } from "../db";
import {
	project,
	projectTask,
	type TaskSystemKey,
	task,
	timeEntry,
} from "../db/schema/domain";
import type { CreateTaskInput, UpdateTaskInput } from "../schema/tasks";
import { ctxAccess, requireAdmin } from "./context";
import { ctxDb } from "./db-ctx";
import { isUniversalTask } from "./guards";
import type { Ctx } from "./types";

// The built-in absence tasks. Site-scoped, seeded once, never archivable and
// never cherry-pickable onto a project: absence carries no client and no
// project, and is logged by the person themselves (PRD 3.5). Paid Leave is the
// third kind (a wedding, a move, a funeral): time off that is neither the
// annual allowance nor illness.
export const VACATION_TASK_NAME = "Vacation";
export const SICK_LEAVE_TASK_NAME = "Sick Leave";
export const PAID_LEAVE_TASK_NAME = "Paid Leave";
export const ABSENCE_TASK_NAMES = [
	VACATION_TASK_NAME,
	SICK_LEAVE_TASK_NAME,
	PAID_LEAVE_TASK_NAME,
] as const;

export type AbsenceKind = "vacation" | "sick" | "paid_leave";

export const tasksService = {
	/** The built-in absence tasks, in a stable order. */
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
	 *  tasks).
	 *
	 *  With no project it is every SITE task: the two absence built-ins, and the
	 *  universal built-ins (Break, Meeting). The universal ones used to be left
	 *  out, so "No project" offered the absence tasks and nothing else —
	 *  which made a break impossible to log, or to write a recurring rule for,
	 *  without attributing it to a client's project. A break is time off the
	 *  clock; nothing about it belongs to a project, and every other layer already
	 *  agrees: `assertTaskAvailable` admits the shape, and the ledger scores a
	 *  project-less break as worked time that is explicitly never "unfiled". The
	 *  picker was the last thing insisting otherwise. */
	listForProject: async (ctx: Ctx, projectId: string | undefined) => {
		const columns = {
			id: task.id,
			name: task.name,
			color: task.color,
			description: task.description,
			isAbsence: task.isAbsence,
			// Callers that must recognise a built-in (the add-block dialog's
			// calendar picker for Meeting) need this, not the editable name.
			systemKey: task.systemKey,
		};

		if (!projectId) {
			// Tenancy in the WHERE as ever. The second arm is defensive: absence is
			// a site-scoped concept today, and an org-scoped absence row could only
			// be a leftover — but if one exists it must still be this org's.
			const rows = await db
				.select(columns)
				.from(task)
				.where(
					and(
						isNull(task.archivedAt),
						or(
							eq(task.scope, "site"),
							and(
								eq(task.isAbsence, true),
								eq(task.organizationId, ctx.organizationId),
							),
						),
					),
				);
			return rows.sort((a, b) => a.name.localeCompare(b.name));
		}

		// Two sources, because a project's options are its cherry-picked subset
		// PLUS the universal built-ins it never had to pick (see isUniversalTask).
		const [picked, universal] = await Promise.all([
			db
				.select(columns)
				.from(projectTask)
				.innerJoin(task, eq(projectTask.taskId, task.id))
				.where(
					and(
						eq(projectTask.organizationId, ctx.organizationId),
						eq(projectTask.projectId, projectId),
						isNull(task.archivedAt),
					),
				),
			db
				.select(columns)
				.from(task)
				.where(
					and(
						eq(task.scope, "site"),
						eq(task.isAbsence, false),
						isNull(task.archivedAt),
					),
				),
		]);

		// Dedupe: a project may still carry a projectTask row pointing at a built-in
		// — either picked by hand before they were universal, or inherited from the
		// org copy that migration 0024 folded into the shared row. Those rows are
		// now redundant rather than wrong, so they're tolerated here instead of
		// being migrated away.
		const byId = new Map([...picked, ...universal].map((t) => [t.id, t]));
		return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
	},

	/**
	 * Resolve the task an engine binds to, by its stable key rather than its
	 * display name. Three engines depend on this — the calendar sync files
	 * meetings, the day assembler proposes work and carves breaks — and all three
	 * used to match `task.name` against a string literal, so renaming a task in
	 * Settings switched the engine off with no error anywhere.
	 *
	 * Accepts either scope: `meeting` and `break` live as site built-ins, while
	 * `development` is org-scoped and renameable. Site wins the tie-break, since
	 * an org row sharing a built-in's key can only be a leftover from before the
	 * built-in was promoted.
	 *
	 * Archived tasks are excluded. That mattered: the old meeting lookup had no
	 * `archivedAt` filter, so archiving the task left the sync engine writing
	 * entries against a dead row.
	 */
	findBySystemKey: async (ctx: Ctx, key: TaskSystemKey) => {
		// `ctxDb`: the engines call this, and so does `create`, which runs inside
		// `setWeekCell`'s transaction. See ./db-ctx.
		const rows = await ctxDb(ctx).query.task.findMany({
			where: and(
				eq(task.systemKey, key),
				isNull(task.archivedAt),
				or(
					eq(task.scope, "site"),
					and(
						eq(task.scope, "organization"),
						eq(task.organizationId, ctx.organizationId),
					),
				),
			),
			columns: { id: true, name: true, scope: true },
		});
		return rows.find((r) => r.scope === "site") ?? rows[0] ?? null;
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
		await requireAdmin(ctx);

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

		// How many of this org's projects offer each task. Org-scoped for the same
		// reason as the entry counts: a shared site task may be picked by a hundred
		// projects platform-wide and that number means nothing here.
		const projectCounts = await db
			.select({ taskId: projectTask.taskId, count: count() })
			.from(projectTask)
			.where(eq(projectTask.organizationId, ctx.organizationId))
			.groupBy(projectTask.taskId);
		const projectCountByTask = new Map(
			projectCounts.map((c) => [c.taskId, c.count]),
		);

		// Universal built-ins have no meaningful project count — they are on every
		// project by definition, and any projectTask rows they still carry are
		// leftovers. The flag lets the screen say "All" instead of a number that
		// would read as "only these 3 projects offer Meeting".
		return tasks.map((t) => ({
			...t,
			universal: isUniversalTask(t),
			entryCount: countByTask.get(t.id) ?? 0,
			projectCount: projectCountByTask.get(t.id) ?? 0,
		}));
	},

	create: async (ctx: Ctx, input: CreateTaskInput) => {
		await requireAdmin(ctx);
		const name = input.name.trim();

		// `task_org_name_uidx` only covers LIVE rows, so nothing at the database
		// level stopped create → archive → create from stacking up an unbounded pile
		// of same-named archived tasks — which is how a settings screen ends up
		// listing twenty "Development"s with no way to tell them apart. Collisions
		// are resolved here instead, with a message per case rather than a raw
		// 23505 for the live one and silent duplication for the archived one.
		const clash = await db.query.task.findFirst({
			where: and(
				eq(task.scope, "organization"),
				eq(task.organizationId, ctx.organizationId),
				eq(task.name, name),
			),
			columns: { id: true, archivedAt: true },
		});
		if (clash) {
			throw new Error(
				clash.archivedAt
					? `An archived task is already called "${name}". Restore it instead of creating a second one.`
					: `A task called "${name}" already exists.`,
			);
		}

		const [created] = await db
			.insert(task)
			.values({
				// There is deliberately no project scope: the taxonomy is strictly
				// global and projects cherry-pick from it.
				scope: "organization",
				organizationId: ctx.organizationId,
				name,
				color: input.color,
				description: input.description,
			})
			.returning();
		if (!created) throw new Error("Failed to create task");
		return created;
	},

	/** Bring an archived task back, keeping its id — so every entry already
	 *  pointing at it stays attached and its history reads continuously. The
	 *  alternative users reach for otherwise is creating a same-named replacement,
	 *  which strands all of that on a dead row. */
	unarchive: async (ctx: Ctx, taskId: string) => {
		await requireAdmin(ctx);
		const existing = await db.query.task.findFirst({
			where: and(
				eq(task.id, taskId),
				eq(task.scope, "organization"),
				eq(task.organizationId, ctx.organizationId),
			),
			columns: { id: true, name: true, archivedAt: true, systemKey: true },
		});
		if (!existing) throw new Error("Task not found");
		if (!existing.archivedAt) return;

		// Both partial unique indexes ignore archived rows, so a live task may have
		// taken this one's name or system key while it was away. Restoring would
		// then hit a raw constraint violation; say which it is instead.
		const blocker = await db.query.task.findFirst({
			where: and(
				eq(task.scope, "organization"),
				eq(task.organizationId, ctx.organizationId),
				isNull(task.archivedAt),
				existing.systemKey
					? or(
							eq(task.name, existing.name),
							eq(task.systemKey, existing.systemKey),
						)
					: eq(task.name, existing.name),
			),
			columns: { id: true },
		});
		if (blocker) {
			throw new Error(
				`Another live task already uses the name "${existing.name}". Rename or archive it first.`,
			);
		}

		await db
			.update(task)
			.set({ archivedAt: null, updatedAt: new Date() })
			.where(eq(task.id, taskId));
	},

	update: async (ctx: Ctx, input: UpdateTaskInput) => {
		await requireAdmin(ctx);
		// Site tasks are matched too, so the rejection below is the one the caller
		// sees. Looking up on organization_id alone silently excluded them — a site
		// row's organization_id is NULL, so the comparison is never true — and the
		// admin got "Task not found" for a row plainly listed on their screen.
		const existing = await db.query.task.findFirst({
			where: and(
				eq(task.id, input.taskId),
				or(eq(task.scope, "site"), eq(task.organizationId, ctx.organizationId)),
			),
		});
		if (!existing) throw new Error("Task not found");
		if (existing.scope === "site") {
			throw new Error("Built-in tasks cannot be edited");
		}

		// An absent field and a field set to null are different edits: drizzle's
		// `.set()` skips `undefined` keys, which is what makes the distinction work.
		const patch: Partial<typeof task.$inferInsert> = { updatedAt: new Date() };
		if (input.name !== undefined) patch.name = input.name.trim();
		if (input.color !== undefined) patch.color = input.color;
		if (input.description !== undefined) patch.description = input.description;

		const [updated] = await db
			.update(task)
			.set(patch)
			.where(eq(task.id, input.taskId))
			.returning();
		return updated;
	},

	archive: async (ctx: Ctx, taskId: string) => {
		await requireAdmin(ctx);
		// Site rows matched here for the same reason as in `update` above: so the
		// caller gets the real reason rather than "Task not found".
		const existing = await db.query.task.findFirst({
			where: and(
				eq(task.id, taskId),
				or(eq(task.scope, "site"), eq(task.organizationId, ctx.organizationId)),
			),
		});
		if (!existing) throw new Error("Task not found");
		// Vacation, Sick Leave, Meeting and Break are built-ins and cannot be
		// removed (PRD §8). For Meeting and Break that unarchivability is the whole
		// point of their being site-scoped: the calendar sync and the day assembler
		// resolve them on every run, and an admin archiving one would switch that
		// engine off with nothing to indicate why.
		if (existing.scope === "site" || existing.isAbsence) {
			throw new Error("Built-in tasks cannot be archived");
		}

		await db
			.update(task)
			.set({ archivedAt: new Date(), updatedAt: new Date() })
			.where(eq(task.id, taskId));
	},

	// ── Per-project cherry-picking ────────────────────────────────────────────
	//
	// One join table, two directions. `setProjectTasks` edits a row of it from the
	// project's side (Team Lead and up, per project); `setTaskProjects` edits a
	// column of it from the task's side, which spans projects the caller may not
	// individually lead and so is Admin-only. Both replace wholesale rather than
	// diffing, so neither can half-apply.

	/** Which of this org's projects currently offer a given task. Admin only —
	 *  it is the read half of `setTaskProjects`. */
	listProjectsForTask: async (ctx: Ctx, taskId: string) => {
		await requireAdmin(ctx);

		const rows = await db
			.select({ projectId: projectTask.projectId })
			.from(projectTask)
			.where(
				and(
					eq(projectTask.organizationId, ctx.organizationId),
					eq(projectTask.taskId, taskId),
				),
			);
		return rows.map((r) => r.projectId);
	},

	/** Replace the set of projects offering a task, wholesale. Admin only: this
	 *  reaches across every project in the org at once, which no per-project role
	 *  grants. */
	setTaskProjects: async (ctx: Ctx, taskId: string, projectIds: string[]) => {
		await requireAdmin(ctx);

		// The task must be one this org may actually put on a project: live, not an
		// absence task, and either a site built-in or its own. Checked in the query
		// so another org's task id can't be smuggled in.
		const usable = await db.query.task.findFirst({
			where: and(
				eq(task.id, taskId),
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
			columns: { id: true, scope: true, isAbsence: true },
		});
		if (!usable) throw new Error("Task is not available to this organization");

		// Rejected rather than ignored: unlike setProjectTasks this names one task
		// explicitly, so a caller reaching here for Meeting has the wrong model of
		// it — and honouring the call would let an admin produce a project list that
		// the entry form then contradicts.
		if (isUniversalTask(usable)) {
			throw new Error(
				"Built-in tasks are available on every project and can't be limited to some of them",
			);
		}

		const unique = [...new Set(projectIds)];
		if (unique.length > 0) {
			const valid = await db.query.project.findMany({
				where: and(
					inArray(project.id, unique),
					eq(project.organizationId, ctx.organizationId),
				),
				columns: { id: true },
			});
			if (valid.length !== unique.length) {
				throw new Error("One or more projects are not in this organization");
			}
		}

		await db.transaction(async (tx) => {
			// Org-scoped delete, so unlinking a shared site task here leaves every
			// other org's links to it untouched.
			await tx
				.delete(projectTask)
				.where(
					and(
						eq(projectTask.organizationId, ctx.organizationId),
						eq(projectTask.taskId, taskId),
					),
				);
			if (unique.length > 0) {
				await tx.insert(projectTask).values(
					unique.map((projectId) => ({
						organizationId: ctx.organizationId,
						projectId,
						taskId,
					})),
				);
			}
		});
	},

	/** Replace a project's picked task subset wholesale. Absence tasks are
	 *  rejected: they carry no project by definition. */
	setProjectTasks: async (ctx: Ctx, projectId: string, taskIds: string[]) => {
		const access = await ctxAccess(ctx);
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
		let toLink = unique;
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
				columns: { id: true, scope: true, isAbsence: true },
			});
			if (valid.length !== unique.length) {
				throw new Error("One or more tasks are not available to this project");
			}

			// Universal built-ins are dropped rather than rejected. This endpoint
			// replaces a project's whole set, so a client that includes Meeting is
			// asking for something already true, not something wrong — erroring would
			// fail the entire save over a no-op. Storing the row instead would be
			// worse: it implies the link is what grants access, and deleting it later
			// would look like it should revoke access when it can't.
			const universal = new Set(valid.filter(isUniversalTask).map((t) => t.id));
			toLink = unique.filter((id) => !universal.has(id));
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
			if (toLink.length > 0) {
				await tx.insert(projectTask).values(
					toLink.map((taskId) => ({
						organizationId: ctx.organizationId,
						projectId,
						taskId,
					})),
				);
			}
		});
	},
};
