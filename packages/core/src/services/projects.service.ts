import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { member, user } from "../db/schema/auth";
import {
	client,
	project,
	projectMember,
	task,
	timeEntry,
	timeEntryType,
} from "../db/schema/domain";
import { orgTimezone } from "../lib/org-time";
import {
	dayBoundsInTz,
	dayKeyInTz,
	endOfMonthKey,
	startOfMonthKey,
} from "../lib/time";
import type {
	AssignProjectMemberInput,
	CreateProjectInput,
	RemoveProjectMemberInput,
} from "../schema/projects";
import type { Ctx } from "./types";

export type ProjectMemberRow = {
	userId: string;
	name: string;
	email: string;
	isVacationApprover: boolean;
	billableRate: string | null;
	costRate: string | null;
};

// Owners/admins bypass the project-membership gate (they may log to and manage
// any project). Kept local to avoid a service import cycle.
const isOrgAdmin = async (ctx: Ctx): Promise<boolean> => {
	const row = await db.query.member.findFirst({
		where: and(
			eq(member.organizationId, ctx.organizationId),
			eq(member.userId, ctx.userId),
		),
	});
	return row?.role === "owner" || row?.role === "admin";
};

// Local org-ownership guard (time-entries.service exports its own; duplicated
// here to avoid an import cycle between the two services).
const assertProjectInOrg = async (ctx: Ctx, projectId: string) => {
	const row = await db.query.project.findFirst({
		where: and(
			eq(project.id, projectId),
			eq(project.organizationId, ctx.organizationId),
		),
	});
	if (!row) throw new Error("Project not found");
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

// Org-wide (not just the requesting user's) reporting bounds for "this month",
// anchored to the org's timezone.
const currentMonthBoundsForOrg = async (organizationId: string) => {
	const tz = await orgTimezone(organizationId);
	const todayKey = dayKeyInTz(new Date(), tz);
	return {
		start: dayBoundsInTz(startOfMonthKey(todayKey), tz).start,
		end: dayBoundsInTz(endOfMonthKey(todayKey), tz).end,
	};
};

const MAX_CONTRIBUTORS_SHOWN = 5;

// Per-project monthly time total + a capped, most-recently-active contributor
// list, derived from actual logged time entries (there's no membership model
// in use — see projectMember's doc comment in the schema).
const loadProjectStats = async (
	ctx: Ctx,
	projectIds: string[],
): Promise<Map<string, ProjectStats>> => {
	const stats = new Map<string, ProjectStats>();
	if (projectIds.length === 0) return stats;
	for (const id of projectIds) stats.set(id, emptyStats());

	const { start, end } = await currentMonthBoundsForOrg(ctx.organizationId);

	const [totals, contributorRows] = await Promise.all([
		db
			.select({
				projectId: timeEntry.projectId,
				totalSeconds: sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`,
			})
			.from(timeEntry)
			.where(
				and(
					inArray(timeEntry.projectId, projectIds),
					gte(timeEntry.startedAt, start),
					lt(timeEntry.startedAt, end),
				),
			)
			.groupBy(timeEntry.projectId),
		// Team is now the assigned members (projectMember), not derived from
		// logged time.
		db
			.select({
				projectId: projectMember.projectId,
				userId: projectMember.userId,
				name: user.name,
			})
			.from(projectMember)
			.innerJoin(user, eq(projectMember.userId, user.id))
			.where(inArray(projectMember.projectId, projectIds))
			.orderBy(user.name),
	]);

	for (const row of totals) {
		if (!row.projectId) continue;
		const entry = stats.get(row.projectId);
		if (entry) entry.monthlyTotalSeconds = Number(row.totalSeconds);
	}

	const contributorsByProject = new Map<
		string,
		{ id: string; name: string }[]
	>();
	for (const row of contributorRows) {
		if (!row.projectId) continue;
		const list = contributorsByProject.get(row.projectId) ?? [];
		list.push({ id: row.userId, name: row.name });
		contributorsByProject.set(row.projectId, list);
	}
	for (const [projectId, contributors] of contributorsByProject) {
		const entry = stats.get(projectId);
		if (!entry) continue;
		entry.contributorCount = contributors.length;
		entry.contributors = contributors.slice(0, MAX_CONTRIBUTORS_SHOWN);
	}

	return stats;
};

// Shared enriched listing. `projectIds` scopes the result (used by listMine);
// omit for the whole org.
const enrichedProjects = async (ctx: Ctx, projectIds?: string[]) => {
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
			tasks: true,
			entryTypes: { where: isNull(timeEntryType.archivedAt) },
		},
		orderBy: desc(project.createdAt),
	});

	const stats = await loadProjectStats(
		ctx,
		projects.map((p) => p.id),
	);

	return projects.map((p) => ({
		...p,
		...(stats.get(p.id) ?? emptyStats()),
	}));
};

export const projectsService = {
	list: async (ctx: Ctx) => enrichedProjects(ctx),

	// Projects the caller may log time against: all projects for owners/admins,
	// otherwise only those they're assigned to. Feeds the time-entry picker.
	listMine: async (ctx: Ctx) => {
		if (await isOrgAdmin(ctx)) return enrichedProjects(ctx);
		const rows = await db
			.select({ projectId: projectMember.projectId })
			.from(projectMember)
			.where(
				and(
					eq(projectMember.organizationId, ctx.organizationId),
					eq(projectMember.userId, ctx.userId),
				),
			);
		return enrichedProjects(
			ctx,
			rows.map((r) => r.projectId),
		);
	},

	// Throws unless the caller may log time to this project (assigned member or
	// owner/admin). Called from the time-entry create/update gate.
	assertProjectMembership: async (ctx: Ctx, projectId: string) => {
		if (await isOrgAdmin(ctx)) return;
		const row = await db.query.projectMember.findFirst({
			where: and(
				eq(projectMember.organizationId, ctx.organizationId),
				eq(projectMember.projectId, projectId),
				eq(projectMember.userId, ctx.userId),
			),
		});
		if (!row) throw new Error("You are not assigned to this project");
	},

	listMembers: async (
		ctx: Ctx,
		projectId: string,
	): Promise<ProjectMemberRow[]> => {
		const rows = await db
			.select({
				userId: projectMember.userId,
				name: user.name,
				email: user.email,
				isVacationApprover: projectMember.isVacationApprover,
				billableRate: projectMember.billableRate,
				costRate: projectMember.costRate,
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
		return rows;
	},

	assignMember: async (ctx: Ctx, input: AssignProjectMemberInput) => {
		await assertProjectInOrg(ctx, input.projectId);
		await db
			.insert(projectMember)
			.values({
				organizationId: ctx.organizationId,
				projectId: input.projectId,
				userId: input.userId,
				isVacationApprover: input.isVacationApprover,
				billableRate: input.billableRate ?? null,
				costRate: input.costRate ?? null,
			})
			.onConflictDoUpdate({
				target: [projectMember.projectId, projectMember.userId],
				set: {
					isVacationApprover: input.isVacationApprover,
					billableRate: input.billableRate ?? null,
					costRate: input.costRate ?? null,
					updatedAt: new Date(),
				},
			});
	},

	removeMember: async (ctx: Ctx, input: RemoveProjectMemberInput) => {
		await db
			.delete(projectMember)
			.where(
				and(
					eq(projectMember.organizationId, ctx.organizationId),
					eq(projectMember.projectId, input.projectId),
					eq(projectMember.userId, input.userId),
				),
			);
	},

	create: async (ctx: Ctx, input: CreateProjectInput) => {
		const full = await db.transaction(async (tx) => {
			if (input.clientId) {
				const ownedClient = await tx.query.client.findFirst({
					where: and(
						eq(client.id, input.clientId),
						eq(client.organizationId, ctx.organizationId),
					),
				});
				if (!ownedClient) throw new Error("Client not found");
			}

			const [created] = await tx
				.insert(project)
				.values({
					organizationId: ctx.organizationId,
					name: input.name,
					clientId: input.clientId,
					code: input.code,
					billable: input.billable,
					billableRate: input.billableRate,
					currency: input.currency,
					color: input.color,
					budgetSeconds: input.budgetHours
						? Math.round(input.budgetHours * 3600)
						: undefined,
					budgetAmount: input.budgetAmount,
				})
				.returning();
			if (!created) throw new Error("Failed to create project");

			if (input.firstTaskName?.trim()) {
				await tx.insert(task).values({
					organizationId: ctx.organizationId,
					projectId: created.id,
					name: input.firstTaskName.trim(),
				});
			}

			const row = await tx.query.project.findFirst({
				where: eq(project.id, created.id),
				with: {
					client: true,
					tasks: true,
					entryTypes: { where: isNull(timeEntryType.archivedAt) },
				},
			});
			if (!row) throw new Error("Failed to create project");
			return row;
		});

		// A project can't have any logged time the instant it's created.
		return { ...full, ...emptyStats() };
	},

	archive: async (ctx: Ctx, projectId: string) => {
		await db
			.update(project)
			.set({ status: "archived" })
			.where(
				and(
					eq(project.id, projectId),
					eq(project.organizationId, ctx.organizationId),
				),
			);
	},
};
