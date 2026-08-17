import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { member, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	projectTask,
	task,
	timeEntry,
} from "../db/schema/domain";
import { orgTimezone } from "../lib/org-time";
import { dayKeyInTz, endOfMonthKey, startOfMonthKey } from "../lib/time";
import type {
	AssignProjectMemberInput,
	CreateProjectInput,
	RemoveProjectMemberInput,
	UpdateProjectInput,
} from "../schema/projects";
import type { Access } from "./access.service";
import { ctxAccess, invalidateCtxAccess } from "./context";
import { assertProjectInOrg } from "./guards";
import { membersService } from "./members.service";
import { tasksService } from "./tasks.service";
import type { Ctx } from "./types";

export type ProjectMemberRow = {
	userId: string;
	name: string;
	email: string;
	role: "member" | "team_lead" | "pm";
	active: boolean;
};

export type ProjectStats = {
	monthlyTotalSeconds: number;
	contributors: { id: string; name: string }[];
	contributorCount: number;
};

const emptyStats = (): ProjectStats => ({
	monthlyTotalSeconds: 0,
	contributors: [],
	contributorCount: 0,
});

const MAX_CONTRIBUTORS_SHOWN = 5;

const currentMonthKeysForOrg = async (organizationId: string) => {
	const tz = await orgTimezone(organizationId);
	const todayKey = dayKeyInTz(new Date(), tz);
	return { from: startOfMonthKey(todayKey), to: endOfMonthKey(todayKey) };
};

const loadProjectStats = async (
	ctx: Ctx,
	projectIds: string[],
): Promise<Map<string, ProjectStats>> => {
	const stats = new Map<string, ProjectStats>();
	if (projectIds.length === 0) return stats;
	for (const id of projectIds) stats.set(id, emptyStats());

	const { from, to } = await currentMonthKeysForOrg(ctx.organizationId);

	const [totals, memberRows] = await Promise.all([
		db
			.select({
				projectId: timeEntry.projectId,
				totalSeconds: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
			})
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.organizationId, ctx.organizationId),
					inArray(timeEntry.projectId, projectIds),
					sql`${timeEntry.date} >= ${from}`,
					sql`${timeEntry.date} <= ${to}`,
				),
			)
			.groupBy(timeEntry.projectId),
		db
			.select({
				projectId: projectMember.projectId,
				userId: projectMember.userId,
				name: user.name,
			})
			.from(projectMember)
			.innerJoin(user, eq(projectMember.userId, user.id))
			.where(
				and(
					eq(projectMember.organizationId, ctx.organizationId),
					inArray(projectMember.projectId, projectIds),
					eq(projectMember.active, true),
				),
			)
			.orderBy(user.name),
	]);

	for (const row of totals) {
		if (!row.projectId) continue;
		const entry = stats.get(row.projectId);
		if (entry) entry.monthlyTotalSeconds = Number(row.totalSeconds);
	}

	const byProject = new Map<string, { id: string; name: string }[]>();
	for (const row of memberRows) {
		const list = byProject.get(row.projectId) ?? [];
		list.push({ id: row.userId, name: row.name });
		byProject.set(row.projectId, list);
	}
	for (const [projectId, contributors] of byProject) {
		const entry = stats.get(projectId);
		if (!entry) continue;
		entry.contributorCount = contributors.length;
		entry.contributors = contributors.slice(0, MAX_CONTRIBUTORS_SHOWN);
	}

	return stats;
};

// The two money fields exist but are PM/Admin-visible only, so they are stripped
// from the payload for anyone else rather than merely hidden in the UI — a
// non-PM never receives them over the wire.
const redactMoney = <
	T extends {
		id: string;
		budgetSeconds: number | null;
		budgetAmount: string | null;
		hourlyPrice: string | null;
	},
>(
	row: T,
	access: Access,
): T => {
	if (access.canViewProjectMoney(row.id)) return row;
	return { ...row, budgetSeconds: null, budgetAmount: null, hourlyPrice: null };
};

const enrichedProjects = async (
	ctx: Ctx,
	access: Access,
	projectIds?: string[],
) => {
	if (projectIds && projectIds.length === 0) return [];
	const projects = await db.query.project.findMany({
		where: projectIds
			? and(
					eq(project.organizationId, ctx.organizationId),
					inArray(project.id, projectIds),
				)
			: eq(project.organizationId, ctx.organizationId),
		with: {
			client: true,
			projectTasks: { with: { task: true } },
		},
		orderBy: desc(project.createdAt),
	});

	const stats = await loadProjectStats(
		ctx,
		projects.map((p) => p.id),
	);

	return projects.map((p) => ({
		...redactMoney(p, access),
		tasks: p.projectTasks
			.map((pt) => pt.task)
			.filter((t) => t.archivedAt === null)
			.sort((a, b) => a.name.localeCompare(b.name)),
		myRole: access.roleOn(p.id),
		...(stats.get(p.id) ?? emptyStats()),
	}));
};

export const projectsService = {
	/** Every project in the org. Admin-facing; the project list screen scopes to
	 *  `listMine` for everyone else. */
	list: async (ctx: Ctx) => {
		const access = await ctxAccess(ctx);
		return enrichedProjects(ctx, access);
	},

	/** Projects the caller may log time against: everything for admins, otherwise
	 *  strictly their assignments. Feeds the time-entry picker, which is why the
	 *  assignment gate exists at all — short dropdowns and clean data. */
	listMine: async (ctx: Ctx) => {
		const access = await ctxAccess(ctx);
		const scope = access.scopeFor("member");
		return enrichedProjects(ctx, access, scope ?? undefined);
	},

	get: async (ctx: Ctx, projectId: string) => {
		const access = await ctxAccess(ctx);
		const rows = await enrichedProjects(ctx, access, [projectId]);
		const row = rows[0];
		if (!row) throw new Error("Project not found");
		return row;
	},

	/** Throws unless the caller may log time to this project. */
	assertProjectMembership: async (ctx: Ctx, projectId: string) => {
		const access = await ctxAccess(ctx);
		access.assertCanTrackOn(projectId);
	},

	listMembers: async (
		ctx: Ctx,
		projectId: string,
	): Promise<ProjectMemberRow[]> => {
		const access = await ctxAccess(ctx);
		// A plain Member sees nothing at project level, not even the team.
		access.assertCanViewProjectEntries(projectId);

		return db
			.select({
				userId: projectMember.userId,
				name: user.name,
				email: user.email,
				role: projectMember.role,
				active: projectMember.active,
			})
			.from(projectMember)
			.innerJoin(user, eq(projectMember.userId, user.id))
			.where(
				and(
					eq(projectMember.organizationId, ctx.organizationId),
					eq(projectMember.projectId, projectId),
				),
			)
			.orderBy(user.name);
	},

	assignMember: async (ctx: Ctx, input: AssignProjectMemberInput) => {
		const access = await ctxAccess(ctx);
		access.assertCanManageProjectMembers(input.projectId);
		await assertProjectInOrg(ctx, input.projectId);

		await db
			.insert(projectMember)
			.values({
				organizationId: ctx.organizationId,
				projectId: input.projectId,
				userId: input.userId,
				role: input.role,
			})
			.onConflictDoUpdate({
				target: [projectMember.projectId, projectMember.userId],
				set: { role: input.role, active: true, updatedAt: new Date() },
			});

		// The assignment may be the caller's own, which would leave the memoized
		// authorization picture describing the world before this write.
		invalidateCtxAccess(ctx);
	},

	/** Deactivates rather than deletes: the person stays on historical close
	 *  sheets (their hours were real) but the assignment grants nothing going
	 *  forward and they drop off future sheets. */
	removeMember: async (ctx: Ctx, input: RemoveProjectMemberInput) => {
		const access = await ctxAccess(ctx);
		access.assertCanManageProjectMembers(input.projectId);

		await db
			.update(projectMember)
			.set({ active: false, updatedAt: new Date() })
			.where(
				and(
					eq(projectMember.organizationId, ctx.organizationId),
					eq(projectMember.projectId, input.projectId),
					eq(projectMember.userId, input.userId),
				),
			);

		invalidateCtxAccess(ctx);
	},

	create: async (ctx: Ctx, input: CreateProjectInput) => {
		const access = await ctxAccess(ctx);
		access.assertCanCreateProjects();

		const created = await db.transaction(async (tx) => {
			const ownedClient = await tx.query.client.findFirst({
				where: and(
					eq(client.id, input.clientId),
					eq(client.organizationId, ctx.organizationId),
				),
				columns: { id: true },
			});
			if (!ownedClient) throw new Error("Client not found");

			const [row] = await tx
				.insert(project)
				.values({
					organizationId: ctx.organizationId,
					name: input.name,
					clientId: input.clientId,
					code: input.code || null,
					type: input.type,
					color: input.color,
					budgetSeconds: input.budgetHours
						? Math.round(input.budgetHours * 3600)
						: null,
					budgetAmount: input.budgetAmount ?? null,
					hourlyPrice: input.hourlyPrice ?? null,
				})
				.returning();
			if (!row) throw new Error("Failed to create project");

			// The creator becomes the project's PM (PRD §11.1). Without this a PM/TL
			// could create a project they immediately cannot close or staff.
			await tx.insert(projectMember).values({
				organizationId: ctx.organizationId,
				projectId: row.id,
				userId: ctx.userId,
				role: "pm",
			});

			if (input.taskIds.length > 0) {
				const valid = await tx.query.task.findMany({
					where: and(
						inArray(task.id, input.taskIds),
						isNull(task.archivedAt),
						eq(task.isAbsence, false),
					),
					columns: { id: true, scope: true, organizationId: true },
				});
				const usable = valid.filter(
					(t) => t.scope === "site" || t.organizationId === ctx.organizationId,
				);
				if (usable.length !== input.taskIds.length) {
					throw new Error("One or more tasks are not available");
				}
				await tx.insert(projectTask).values(
					usable.map((t) => ({
						organizationId: ctx.organizationId,
						projectId: row.id,
						taskId: t.id,
					})),
				);
			}
			return row;
		});

		// The caller is now this project's PM, so re-resolve before returning —
		// otherwise the response would redact the money fields they just set.
		// The memoized picture predates the assignment above and would still say
		// "not a member", so it has to be dropped for the re-resolve to see it.
		invalidateCtxAccess(ctx);
		return projectsService.get(ctx, created.id);
	},

	update: async (ctx: Ctx, input: UpdateProjectInput) => {
		const access = await ctxAccess(ctx);
		// Editing budgets/prices is PM territory; TLs manage people, not config.
		access.assertCanCloseProject(input.projectId);
		await assertProjectInOrg(ctx, input.projectId);

		// A patch: only the keys the caller sent are written, so a rename doesn't
		// have to carry the budget, the client and the task subset along with it
		// just to keep them. See updateProjectInput.
		await db.transaction(async (tx) => {
			if (input.clientId !== undefined) {
				const ownedClient = await tx.query.client.findFirst({
					where: and(
						eq(client.id, input.clientId),
						eq(client.organizationId, ctx.organizationId),
					),
					columns: { id: true },
				});
				if (!ownedClient) throw new Error("Client not found");
			}

			await tx
				.update(project)
				.set({
					...(input.name !== undefined ? { name: input.name } : {}),
					...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
					...(input.code !== undefined ? { code: input.code || null } : {}),
					// Project type is changeable after creation without history (e.g. a
					// Fixed Scope engagement rolling into Maintenance). Close sheets
					// render according to the type at the time of viewing. The
					// type-specific config moves with it — the schema refuses a budget
					// or price that arrives without its type — so the three are set
					// together or not at all.
					...(input.type !== undefined
						? {
								type: input.type,
								budgetSeconds: input.budgetHours
									? Math.round(input.budgetHours * 3600)
									: null,
								budgetAmount: input.budgetAmount ?? null,
								hourlyPrice: input.hourlyPrice ?? null,
							}
						: {}),
					...(input.color !== undefined ? { color: input.color } : {}),
					updatedAt: new Date(),
				})
				.where(eq(project.id, input.projectId));
		});

		if (input.taskIds !== undefined) {
			await tasksService.setProjectTasks(ctx, input.projectId, input.taskIds);
		}
		return projectsService.get(ctx, input.projectId);
	},

	/** Archive, never hard delete — agencies churn projects and history must
	 *  survive (close sheets, reports and variance all read backwards). */
	archive: async (ctx: Ctx, projectId: string) => {
		const access = await ctxAccess(ctx);
		access.assertCanCloseProject(projectId);
		await db
			.update(project)
			.set({ status: "archived", updatedAt: new Date() })
			.where(
				and(
					eq(project.id, projectId),
					eq(project.organizationId, ctx.organizationId),
				),
			);
	},

	unarchive: async (ctx: Ctx, projectId: string) => {
		const access = await ctxAccess(ctx);
		access.assertCanCloseProject(projectId);
		await db
			.update(project)
			.set({ status: "active", updatedAt: new Date() })
			.where(
				and(
					eq(project.id, projectId),
					eq(project.organizationId, ctx.organizationId),
				),
			);
	},

	/** The tasks selectable on this project — its cherry-picked subset. */
	listTasks: async (ctx: Ctx, projectId: string) =>
		tasksService.listForProject(ctx, projectId),

	/** Assignable people: every active member of the org, for the team panel. Read
	 *  off `member` (not `projectMember`) so people with no assignment yet — the
	 *  ones you actually want to add — are in the list. Archived people are not:
	 *  they keep the assignments they already had, and can't be given new ones. */
	listAssignable: async (ctx: Ctx, projectId: string) => {
		const access = await ctxAccess(ctx);
		access.assertCanManageProjectMembers(projectId);
		const archived = await membersService.archivedUserIds(ctx);
		const rows = await db
			.select({ userId: user.id, name: user.name, email: user.email })
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(eq(member.organizationId, ctx.organizationId))
			.orderBy(asc(user.name));
		return rows.filter((r) => !archived.has(r.userId));
	},
};
