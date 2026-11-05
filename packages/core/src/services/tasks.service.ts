import { and, asc, count, desc, eq, isNull, max, or } from "drizzle-orm";

import { db } from "../db";
import { type TaskSystemKey, task, timeEntry } from "../db/schema/domain";
import { hiddenTask } from "../db/schema/settings";
import type {
	CreateTaskInput,
	SetTaskHiddenInput,
	UpdateTaskInput,
} from "../schema/tasks";
import { diffFields, recordAudit } from "./audit";
import { ctxAccess, requireAdmin } from "./context";
import { ctxDb } from "./db-ctx";
import type { Ctx } from "./types";

const taskTarget = (row: { id: string; name: string }) => ({
	type: "task",
	id: row.id,
	label: row.name,
});

// The built-in absence tasks. Site-scoped, seeded once, never archivable and
// never logged against a project: absence carries no client and no
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

	/** Tasks selectable when logging against a given project: the whole global
	 *  list — every live non-absence task of the org plus the site built-ins. The
	 *  taxonomy is one shared vocabulary (PRD 3.5, revised Sept 2026); projects no
	 *  longer pick a subset of it.
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
			// The picker shows the list under its group headers.
			group: task.group,
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

		// With a project: the whole global list — every live non-absence task of
		// this org plus the site built-ins. Projects no longer pick a subset.
		const rows = await db
			.select(columns)
			.from(task)
			.where(
				and(
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
			);
		return rows.sort((a, b) => a.name.localeCompare(b.name));
	},

	/** The last three distinct tasks this person logged on a project, newest
	 *  first — the picker's "Recent" group. On a project they have not logged on
	 *  yet, their last three anywhere. Read from their own entries; nothing is
	 *  stored. Absence never counts: it is not offered with a project. */
	recentForProject: async (ctx: Ctx, projectId: string): Promise<string[]> => {
		const recent = async (onProject: boolean) => {
			const last = max(timeEntry.date);
			const rows = await db
				.select({ taskId: timeEntry.taskId, last })
				.from(timeEntry)
				.innerJoin(task, eq(task.id, timeEntry.taskId))
				.where(
					and(
						eq(timeEntry.organizationId, ctx.organizationId),
						eq(timeEntry.userId, ctx.userId),
						onProject ? eq(timeEntry.projectId, projectId) : undefined,
						eq(task.isAbsence, false),
						isNull(task.archivedAt),
					),
				)
				.groupBy(timeEntry.taskId)
				.orderBy(desc(last))
				.limit(3);
			return rows.map((r) => r.taskId);
		};
		const onProject = await recent(true);
		return onProject.length > 0 ? onProject : recent(false);
	},

	/** The tasks the caller has switched off in this org (Preferences → Your
	 *  tasks). Ids only: the picker already holds the list, and filters it
	 *  itself so the task an entry already has can stay on offer. */
	hiddenIds: async (ctx: Ctx): Promise<string[]> => {
		await ctxAccess(ctx);
		const rows = await db
			.select({ taskId: hiddenTask.taskId })
			.from(hiddenTask)
			.where(
				and(
					eq(hiddenTask.organizationId, ctx.organizationId),
					eq(hiddenTask.userId, ctx.userId),
				),
			);
		return rows.map((r) => r.taskId);
	},

	/** Switch one task off for the caller, or back on. Only a task the picker
	 *  could offer them qualifies — this org's or a site built-in, never an
	 *  absence task (those are never in the list) and never another org's,
	 *  which reads as not found. Idempotent both ways. */
	setHidden: async (ctx: Ctx, input: SetTaskHiddenInput) => {
		await ctxAccess(ctx);
		const target = await db.query.task.findFirst({
			where: and(
				eq(task.id, input.taskId),
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
		if (!target) throw new Error("Task not found");

		if (input.hidden) {
			await db
				.insert(hiddenTask)
				.values({
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					taskId: target.id,
				})
				.onConflictDoNothing();
			return;
		}
		await db
			.delete(hiddenTask)
			.where(
				and(
					eq(hiddenTask.organizationId, ctx.organizationId),
					eq(hiddenTask.userId, ctx.userId),
					eq(hiddenTask.taskId, target.id),
				),
			);
	},

	/** Switch every task back on for the caller, in this org only. */
	showAll: async (ctx: Ctx) => {
		await ctxAccess(ctx);
		await db
			.delete(hiddenTask)
			.where(
				and(
					eq(hiddenTask.organizationId, ctx.organizationId),
					eq(hiddenTask.userId, ctx.userId),
				),
			);
	},

	/** Switch every task in the caller's list off, in this org only. A task
	 *  added later stays on, as with `setHidden`. */
	hideAll: async (ctx: Ctx) => {
		await ctxAccess(ctx);
		const rows = await tasksService.listSelectable(ctx);
		if (rows.length === 0) return;
		await db
			.insert(hiddenTask)
			.values(
				rows.map((r) => ({
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					taskId: r.id,
				})),
			)
			.onConflictDoNothing();
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

	/** The whole global list: site built-ins that aren't absence tasks, plus the
	 *  org's own tasks. */
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

		return tasks.map((t) => ({
			...t,
			entryCount: countByTask.get(t.id) ?? 0,
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
				group: input.group ?? "general",
				color: input.color,
				description: input.description,
			})
			.returning();
		if (!created) throw new Error("Failed to create task");
		await recordAudit(ctx, {
			kind: "task.created",
			target: taskTarget(created),
			details: { group: created.group },
		});
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
		await recordAudit(ctx, {
			kind: "task.restored",
			target: taskTarget(existing),
		});
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
		if (input.group !== undefined) patch.group = input.group;
		if (input.color !== undefined) patch.color = input.color;
		if (input.description !== undefined) patch.description = input.description;

		const [updated] = await db
			.update(task)
			.set(patch)
			.where(eq(task.id, input.taskId))
			.returning();
		const changes = diffFields(existing, updated, [
			"name",
			"group",
			"color",
			"description",
		]);
		if (updated && changes) {
			await recordAudit(ctx, {
				kind: "task.updated",
				target: taskTarget(updated),
				changes,
			});
		}
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
		await recordAudit(ctx, {
			kind: "task.archived",
			target: taskTarget(existing),
		});
	},
};
