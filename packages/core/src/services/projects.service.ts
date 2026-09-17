import {
	and,
	asc,
	countDistinct,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	lte,
	sql,
} from "drizzle-orm";

import { db } from "../db";
import { member, user } from "../db/schema/auth";
import { client, project, projectMember, timeEntry } from "../db/schema/domain";
import { memberProfile } from "../db/schema/people";
import { orgTimezone } from "../lib/org-time";
import { dayKeyInTz, endOfMonthKey, startOfMonthKey } from "../lib/time";
import type {
	AssignProjectMemberInput,
	CreateProjectInput,
	RemoveProjectMemberInput,
	UpdateProjectInput,
} from "../schema/projects";
import { AccessError, type Access } from "./access.service";
import { ctxAccess, invalidateCtxAccess } from "./context";
import { emitEvent, projectWebhookPayload } from "./events";
import { assertProjectInOrg, assertUserInOrg } from "./guards";
import { membersService } from "./members.service";
import { tasksService } from "./tasks.service";
import type { Ctx } from "./types";
import { assertOwnUpload } from "./uploads.service";

export type ProjectMemberRow = {
	userId: string;
	name: string;
	email: string;
	role: "member" | "team_lead" | "pm";
	active: boolean;
	/** Everything they ever logged on the project, and when they last did. */
	allTimeSeconds: number;
	lastEntry: string | null;
};

export type ProjectStats = {
	monthlyTotalSeconds: number;
	allTimeSeconds: number;
	contributors: { id: string; name: string }[];
	contributorCount: number;
};

/** The strip at the top of a project's page: the whole of its history in five
 *  numbers, whatever period the table below is set to. */
export type ProjectOverview = {
	allTimeSeconds: number;
	entryCount: number;
	/** Distinct people who ever logged on it — not the roster. */
	peopleCount: number;
	firstEntry: string | null;
	lastEntry: string | null;
	overtimeSeconds: number;
	monthSeconds: number;
	monthPeople: number;
};

const emptyStats = (): ProjectStats => ({
	monthlyTotalSeconds: 0,
	allTimeSeconds: 0,
	contributors: [],
	contributorCount: 0,
});

const SUM_SECONDS = sql<string>`coalesce(sum(${timeEntry.durationSeconds}), 0)`;

const MAX_CONTRIBUTORS_SHOWN = 5;

const currentMonthKeysForOrg = async (organizationId: string) => {
	const tz = await orgTimezone(organizationId);
	const todayKey = dayKeyInTz(new Date(), tz);

	return { from: startOfMonthKey(todayKey), to: endOfMonthKey(todayKey) };
};

/** `ownOnly` narrows every figure to the caller's own entries and leaves the
 *  contributors empty — what a plain Member may know about a project. */
const loadProjectStats = async (
	ctx: Ctx,
	projectIds: string[],
	{ ownOnly }: { ownOnly: boolean },
): Promise<Map<string, ProjectStats>> => {
	const stats = new Map<string, ProjectStats>();

	if (projectIds.length === 0) return stats;

	for (const id of projectIds) stats.set(id, emptyStats());

	const { from, to } = await currentMonthKeysForOrg(ctx.organizationId);

	const onProjects = and(
		eq(timeEntry.organizationId, ctx.organizationId),
		inArray(timeEntry.projectId, projectIds),
		ownOnly ? eq(timeEntry.userId, ctx.userId) : undefined,
	);

	const [totals, allTime, memberRows] = await Promise.all([
		db
			.select({
				projectId: timeEntry.projectId,
				totalSeconds: SUM_SECONDS,
			})
			.from(timeEntry)
			.where(
				and(
					onProjects,
					sql`${timeEntry.date} >= ${from}`,
					sql`${timeEntry.date} <= ${to}`,
				),
			)
			.groupBy(timeEntry.projectId),
		db
			.select({
				projectId: timeEntry.projectId,
				totalSeconds: SUM_SECONDS,
			})
			.from(timeEntry)
			.where(onProjects)
			.groupBy(timeEntry.projectId),
		ownOnly
			? []
			: db
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

	for (const row of allTime) {
		if (!row.projectId) continue;
		const entry = stats.get(row.projectId);

		if (entry) entry.allTimeSeconds = Number(row.totalSeconds);
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
		with: { client: true },
		orderBy: desc(project.createdAt),
	});

	// Project-level statistics are a Team Lead capability, so they are computed
	// only for the projects that will be allowed to carry them. This is the same
	// rule `redactMoney` applies one field-set over, and it is the §4 line "a
	// Member sees nothing at project level — not even the project's total hours".
	// A plain Member's row is summed from their own entries alone, which they
	// already see everywhere else, rather than from the project's real hours
	// blanked out afterwards — so the project total is never read, never
	// serialized and never one refactor away from being sent.
	const ids = projects.map((p) => p.id);
	const visible = (id: string) => access.canViewProjectEntries(id);

	const [projectStats, ownStats] = await Promise.all([
		loadProjectStats(ctx, ids.filter(visible), { ownOnly: false }),
		loadProjectStats(
			ctx,
			ids.filter((id) => !visible(id)),
			{ ownOnly: true },
		),
	]);

	return projects.map((p) => ({
		...redactMoney(p, access),
		// Held-as, not the assignment row: a Team Lead on the project is a PM
		// here, and the screen gates its tabs on this.
		myRole: access.heldAs(p.id),
		/** Whose hours the figures sum: the whole project's, or the caller's own. */
		statsScope: visible(p.id) ? ("project" as const) : ("own" as const),
		...(projectStats.get(p.id) ?? ownStats.get(p.id) ?? emptyStats()),
	}));
};

export const projectsService = {
	/** The projects screen: every project in the org for an Admin, otherwise
	 *  strictly the caller's own assignments.
	 *
	 *  This used to be unscoped for everyone. Its docstring said "Admin-facing"
	 *  and the only thing it resolved `Access` for was redacting the two money
	 *  fields, but nothing asserted the adjective — `orgMiddleware` was the whole
	 *  gate, so any member could enumerate every project in the organization,
	 *  with its client and its month's hours, both through this and through
	 *  `GET /api/v1/projects`. §4 is explicit that a Member sees nothing at
	 *  project level, so the scope belongs here rather than in the sentence.
	 *
	 *  Kept distinct from `listMine` even though the two now agree for most
	 *  callers: this one answers "what may I look at", `listMine` answers "what
	 *  may I log time against", and an Admin is unscoped for the first and (via
	 *  `canTrackOn`) unscoped for the second for a different reason. */
	list: async (ctx: Ctx) => {
		const access = await ctxAccess(ctx);
		const scope = access.scopeFor("member");

		return enrichedProjects(ctx, access, scope ?? undefined);
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

		const [rows, logged] = await Promise.all([
			db
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
				.orderBy(user.name),
			// What each of them ever logged here — the Team page reads it beside
			// the role, so "who is this and do they still work here" is one look.
			db
				.select({
					userId: timeEntry.userId,
					seconds: SUM_SECONDS,
					last: sql<string | null>`max(${timeEntry.date})`,
				})
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.organizationId, ctx.organizationId),
						eq(timeEntry.projectId, projectId),
					),
				)
				.groupBy(timeEntry.userId),
		]);

		const byUser = new Map(logged.map((r) => [r.userId, r]));

		return rows.map((r) => ({
			...r,
			allTimeSeconds: Number(byUser.get(r.userId)?.seconds ?? 0),
			lastEntry: byUser.get(r.userId)?.last ?? null,
		}));
	},

	/** The five all-time numbers at the top of a project's page. Team Lead and
	 *  up, like everything else at project level. */
	overview: async (ctx: Ctx, projectId: string): Promise<ProjectOverview> => {
		const access = await ctxAccess(ctx);
		access.assertCanViewProjectEntries(projectId);
		await assertProjectInOrg(ctx, projectId);
		const { from, to } = await currentMonthKeysForOrg(ctx.organizationId);

		const onProject = and(
			eq(timeEntry.organizationId, ctx.organizationId),
			eq(timeEntry.projectId, projectId),
		);

		const [[all], [month]] = await Promise.all([
			db
				.select({
					seconds: SUM_SECONDS,
					entries: sql<string>`count(*)`,
					people: countDistinct(timeEntry.userId),
					first: sql<string | null>`min(${timeEntry.date})`,
					last: sql<string | null>`max(${timeEntry.date})`,
					overtime: sql<string>`coalesce(sum(case when ${timeEntry.overtime} then ${timeEntry.durationSeconds} else 0 end), 0)`,
				})
				.from(timeEntry)
				.where(onProject),
			db
				.select({
					seconds: SUM_SECONDS,
					people: countDistinct(timeEntry.userId),
				})
				.from(timeEntry)
				.where(
					and(onProject, gte(timeEntry.date, from), lte(timeEntry.date, to)),
				),
		]);

		return {
			allTimeSeconds: Number(all?.seconds ?? 0),
			entryCount: Number(all?.entries ?? 0),
			peopleCount: Number(all?.people ?? 0),
			firstEntry: all?.first ?? null,
			lastEntry: all?.last ?? null,
			overtimeSeconds: Number(all?.overtime ?? 0),
			monthSeconds: Number(month?.seconds ?? 0),
			monthPeople: Number(month?.people ?? 0),
		};
	},

	assignMember: async (ctx: Ctx, input: AssignProjectMemberInput) => {
		const access = await ctxAccess(ctx);
		access.assertCanManageProjectMembers(input.projectId);
		await assertProjectInOrg(ctx, input.projectId);
		// The capability check is about the PROJECT. Without this, any userId
		// made an assignment — and an assignment is one of the sources the close
		// sheet builds its rows from.
		await assertUserInOrg(ctx, input.userId);

		// The promise `listAssignable` makes, kept where it can be enforced: an
		// archived person keeps the assignments they had, and gets no new one or
		// re-activated old one. Only hiding them from the picker left the API,
		// the assistant and the MCP server free to staff a leaver.
		const archived = await db.query.memberProfile.findFirst({
			where: and(
				eq(memberProfile.organizationId, ctx.organizationId),
				eq(memberProfile.userId, input.userId),
				isNotNull(memberProfile.archivedAt),
			),
			columns: { id: true },
		});

		if (archived) {
			throw new Error("That person is archived. Restore them to assign them.");
		}

		// `canManageProjectMembers` only asks whether the caller may touch the
		// roster at all — Team Lead and up. Without this, a Team Lead (a rank
		// that passes that check) could hand out PM, including to themselves, or
		// re-rank an existing PM downward: one click on the new Team page. A
		// non-admin caller may neither assign a role above their own held rank
		// nor touch someone who already holds a role above it.
		if (!access.isAdmin) {
			const existing = await db.query.projectMember.findFirst({
				where: and(
					eq(projectMember.organizationId, ctx.organizationId),
					eq(projectMember.projectId, input.projectId),
					eq(projectMember.userId, input.userId),
				),
				columns: { role: true },
			});

			if (
				existing &&
				!access.canActOnProjectRole(input.projectId, existing.role)
			) {
				throw new AccessError("You cannot change this person's role");
			}

			if (!access.canActOnProjectRole(input.projectId, input.role)) {
				throw new AccessError("You cannot assign that role");
			}
		}

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

		// Same ceiling as assignMember: a Team Lead may drop a plain Member but
		// not the PM (or another Team Lead who outranks their own assignment).
		if (!access.isAdmin) {
			const existing = await db.query.projectMember.findFirst({
				where: and(
					eq(projectMember.organizationId, ctx.organizationId),
					eq(projectMember.projectId, input.projectId),
					eq(projectMember.userId, input.userId),
				),
				columns: { role: true },
			});

			if (
				existing &&
				!access.canActOnProjectRole(input.projectId, existing.role)
			) {
				throw new AccessError("You cannot remove this person");
			}
		}

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
		assertOwnUpload(ctx, input.icon);

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
					icon: input.icon ?? null,
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

			return row;
		});

		// The caller is now this project's PM, so re-resolve before returning —
		// otherwise the response would redact the money fields they just set.
		// The memoized picture predates the assignment above and would still say
		// "not a member", so it has to be dropped for the re-resolve to see it.
		invalidateCtxAccess(ctx);
		await emitEvent(ctx, "project.created", () =>
			projectWebhookPayload(ctx, created.id),
		);

		return projectsService.get(ctx, created.id);
	},

	update: async (ctx: Ctx, input: UpdateProjectInput) => {
		const access = await ctxAccess(ctx);
		// Editing budgets/prices is PM territory; TLs manage people, not config.
		access.assertCanManageProject(input.projectId);
		await assertProjectInOrg(ctx, input.projectId);
		assertOwnUpload(ctx, input.icon);

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

			const patch: Partial<typeof project.$inferInsert> = {
				updatedAt: new Date(),
			};

			if (input.name !== undefined) patch.name = input.name;

			if (input.clientId !== undefined) patch.clientId = input.clientId;

			if (input.code !== undefined) patch.code = input.code || null;

			if (input.icon !== undefined) patch.icon = input.icon;

			if (input.openToOrg !== undefined) patch.openToOrg = input.openToOrg;

			// Project type is changeable after creation without history (e.g. a
			// Fixed Scope engagement rolling into Maintenance). Close sheets render
			// according to the type at the time of viewing. The type-specific config
			// moves with it — the schema refuses a budget or price that arrives
			// without its type — so the four are set together or not at all.
			if (input.type !== undefined) {
				patch.type = input.type;
				patch.budgetSeconds = input.budgetHours
					? Math.round(input.budgetHours * 3600)
					: null;
				patch.budgetAmount = input.budgetAmount ?? null;
				patch.hourlyPrice = input.hourlyPrice ?? null;
			}

			await tx
				.update(project)
				.set(patch)
				.where(eq(project.id, input.projectId));
		});

		// Opening or closing the project changes what the caller may track on,
		// and the memoized picture was resolved before the write.
		if (input.openToOrg !== undefined) invalidateCtxAccess(ctx);
		await emitEvent(ctx, "project.updated", () =>
			projectWebhookPayload(ctx, input.projectId),
		);

		return projectsService.get(ctx, input.projectId);
	},

	/** Archive, never hard delete — agencies churn projects and history must
	 *  survive (close sheets and reports all read backwards). */
	archive: async (ctx: Ctx, projectId: string) => {
		const access = await ctxAccess(ctx);
		access.assertCanManageProject(projectId);
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
		access.assertCanManageProject(projectId);
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
