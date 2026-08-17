import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { member } from "../db/schema/auth";
import { projectMember } from "../db/schema/domain";
import type { Ctx } from "./types";

// The section-4 capability matrix, in one place.
//
// Two independent axes:
//   * ONE global role — org Admin (better-auth's member.role owner|admin). There
//     is deliberately no super-admin tier: Admin is a small trusted group.
//   * A PER-ASSIGNMENT project role — Member / Team Lead / PM. The same person is
//     PM on one project and a plain member on another, so a project role is never
//     a property of the person.
//
// Guiding principles from the PRD that this file exists to enforce:
//   * Members see strictly their own time entries and nothing at project level —
//     not even the project's total hours.
//   * Team Lead = visibility + team management. No money, no close.
//   * PM = Team Lead + close + money context, and still nothing about any other
//     project.
//   * Admin sees everything.

export type ProjectRole = "member" | "team_lead" | "pm";

// Ordered so "at least this role" is a numeric comparison. Admin is not in here:
// it is a separate axis that satisfies every project-level check by override.
const RANK: Record<ProjectRole, number> = {
	member: 1,
	team_lead: 2,
	pm: 3,
};

export class AccessError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AccessError";
	}
}

/** The caller is not a member of the organization their Ctx names.
 *
 *  Its own class because the boundary treats it differently from every other
 *  AccessError: a member who lacks a capability gets an error, someone who is
 *  not in the workspace at all gets shown the door (see `orgMiddleware`). */
export class NotAMemberError extends AccessError {
	constructor(readonly organizationId: string) {
		super("You are not a member of this organization");
		this.name = "NotAMemberError";
	}
}

// A caller's full authorization picture, resolved with two queries and then
// answered from memory. Services should resolve this ONCE per request and pass
// it down rather than re-querying per project, which is what turns a report over
// 40 projects into 40 role lookups.
export class Access {
	constructor(
		readonly userId: string,
		readonly organizationId: string,
		readonly isAdmin: boolean,
		private readonly roleByProject: ReadonlyMap<string, ProjectRole>,
	) {}

	// The caller's role on a project, or null when unassigned. Admins are NOT
	// synthesised into a role here — `isAdmin` is checked separately by each
	// capability, so an admin's actual assignment (or lack of one) stays visible
	// to callers that care, e.g. the close sheet's "your projects" filter.
	roleOn(projectId: string): ProjectRole | null {
		return this.roleByProject.get(projectId) ?? null;
	}

	/** The caller's raw assignments, admin override excluded. Unlike `scopeFor`
	 *  this never collapses to "all projects", so it's what a UI uses to answer
	 *  "which projects am I actually PM of". */
	assignments(): [string, ProjectRole][] {
		return [...this.roleByProject.entries()];
	}

	private atLeast(projectId: string, role: ProjectRole): boolean {
		if (this.isAdmin) return true;
		const mine = this.roleByProject.get(projectId);
		return mine != null && RANK[mine] >= RANK[role];
	}

	/** Every project id the caller holds at least `role` on. Admins get null,
	 *  meaning "unscoped — all projects", which callers translate into "no
	 *  project filter in the WHERE clause" rather than a 200-id IN list. */
	scopeFor(role: ProjectRole): string[] | null {
		if (this.isAdmin) return null;
		return [...this.roleByProject.entries()]
			.filter(([, mine]) => RANK[mine] >= RANK[role])
			.map(([projectId]) => projectId);
	}

	// ── Capabilities (one method per row of the §4.1 matrix) ──────────────────

	/** Track own time. Requires an assignment of any role: people can only log
	 *  time on projects they are assigned to, which keeps entry dropdowns short
	 *  and the data clean. */
	canTrackOn(projectId: string): boolean {
		return this.atLeast(projectId, "member");
	}

	/** See ALL entries on a project (hours, descriptions, who). Team Lead and up —
	 *  a plain Member sees strictly their own entries. */
	canViewProjectEntries(projectId: string): boolean {
		return this.atLeast(projectId, "team_lead");
	}

	/** Add/remove people on a project. Note this deliberately gives Team Leads a
	 *  light management capability beyond pure visibility. */
	canManageProjectMembers(projectId: string): boolean {
		return this.atLeast(projectId, "team_lead");
	}

	/** See the project's budget and hourly price. PM and Admin only — the two
	 *  money fields in the system are visible nowhere else. */
	canViewProjectMoney(projectId: string): boolean {
		return this.atLeast(projectId, "pm");
	}

	/** Close sheet: adjust, override absence days, submit. PM and Admin. The
	 *  Final column and finalize/re-open are Admin-only and are checked with
	 *  `isAdmin` directly, not through here. */
	canCloseProject(projectId: string): boolean {
		return this.atLeast(projectId, "pm");
	}

	/** Override/correct another person's Vacation or Sick Leave entries. PM of a
	 *  project the person is on, or Admin. (PMs never edit other people's regular
	 *  worked-time entries — corrections to worked hours live in the close
	 *  sheet's Adjusted column, which is what preserves the clean line between
	 *  "what people said they worked" and "what we billed".) */
	canOverrideAbsenceFor(projectIds: string[]): boolean {
		if (this.isAdmin) return true;
		return projectIds.some((id) => this.atLeast(id, "pm"));
	}

	/** Create projects and clients. Anyone holding PM or Team Lead on at least
	 *  one project, plus Admins. */
	canCreateProjects(): boolean {
		if (this.isAdmin) return true;
		return [...this.roleByProject.values()].some(
			(role) => RANK[role] >= RANK.team_lead,
		);
	}

	// ── Assertions ────────────────────────────────────────────────────────────

	assertAdmin(): void {
		if (!this.isAdmin) throw new AccessError("Admin access required");
	}

	assertCanTrackOn(projectId: string): void {
		if (!this.canTrackOn(projectId)) {
			throw new AccessError("You are not assigned to this project");
		}
	}

	assertCanViewProjectEntries(projectId: string): void {
		if (!this.canViewProjectEntries(projectId)) {
			throw new AccessError("You cannot view this project's time");
		}
	}

	assertCanManageProjectMembers(projectId: string): void {
		if (!this.canManageProjectMembers(projectId)) {
			throw new AccessError("You cannot manage this project's team");
		}
	}

	assertCanCloseProject(projectId: string): void {
		if (!this.canCloseProject(projectId)) {
			throw new AccessError("You cannot close this project");
		}
	}

	assertCanCreateProjects(): void {
		if (!this.canCreateProjects()) {
			throw new AccessError("You cannot create projects");
		}
	}
}

export const accessService = {
	/** Resolve the caller's authorization picture. Two queries, no N+1.
	 *
	 *  Throws `NotAMemberError` when the caller has no membership row. A Ctx is
	 *  built from `session.activeOrganizationId`, which is stamped onto the
	 *  session when the workspace is entered and never revisited — removing
	 *  someone from an organization does not invalidate their sessions, so
	 *  without this the Ctx of an ex-member stayed a valid-looking Ctx until it
	 *  expired. This used to resolve to `isAdmin: false, no assignments`, which
	 *  is the correct answer to "what may they do on a project" and the WRONG
	 *  answer to "are they in the room": every org-wide read that asks neither
	 *  question (`clientsService.list`, `tasksService.list`) answered them
	 *  anyway. Membership is the precondition, not a capability, so it is
	 *  checked once here rather than re-asserted in each of those functions. */
	resolve: async (ctx: Ctx): Promise<Access> => {
		const [membership, assignments] = await Promise.all([
			db.query.member.findFirst({
				where: and(
					eq(member.organizationId, ctx.organizationId),
					eq(member.userId, ctx.userId),
				),
				columns: { role: true },
			}),
			db
				.select({
					projectId: projectMember.projectId,
					role: projectMember.role,
				})
				.from(projectMember)
				.where(
					and(
						eq(projectMember.organizationId, ctx.organizationId),
						eq(projectMember.userId, ctx.userId),
						// An inactive assignment keeps the person on historical close
						// sheets but grants nothing going forward.
						eq(projectMember.active, true),
					),
				),
		]);

		if (!membership) throw new NotAMemberError(ctx.organizationId);

		// better-auth models org ownership as a distinct role; both map to the
		// single Admin tier this product has.
		const isAdmin = membership.role === "owner" || membership.role === "admin";

		return new Access(
			ctx.userId,
			ctx.organizationId,
			isAdmin,
			new Map(assignments.map((a) => [a.projectId, a.role])),
		);
	},

	/** Convenience for the many call sites that only need the global tier. */
	requireAdmin: async (ctx: Ctx): Promise<Access> => {
		const access = await accessService.resolve(ctx);
		access.assertAdmin();
		return access;
	},
};
