import { and, eq, inArray } from "drizzle-orm";

import { member } from "../db/schema/auth";
import { project, projectMember } from "../db/schema/domain";
import { teamLeadPerson } from "../db/schema/people";
import { UserFacingError } from "../lib/user-facing-error";
import { ctxDb } from "./db-ctx";
import type { Ctx } from "./types";

// The section-4 capability matrix, in one place.
//
// Three independent axes (revised Sept 2026):
//   * ONE global role — org Admin (better-auth's member.role owner|admin). There
//     is deliberately no super-admin tier: Admin is a small trusted group.
//   * A PER-ASSIGNMENT project role — Member / Team Lead / PM. The same person is
//     PM on one project and a plain member on another, so a project role is never
//     a property of the person.
//   * A PEOPLE LIST — the Team Lead of the org chart. Somebody with people on
//     their list (`team_lead_person`, edited by an Admin) sees everything about
//     those people: their time on every project, their Tracking status, their
//     time off. And on any project where their OWN assignment is `team_lead`,
//     they see and manage it as a PM does. A plain `member` assignment stays
//     `member` — a people list is not a blanket PM grant on every project the
//     lead happens to be on.
//
// Guiding principles this file exists to enforce:
//   * Members see strictly their own time entries and nothing at project level —
//     not even the project's total hours. They do get every report, scoped to
//     themselves: a report about yourself is still a report.
//   * PM = project config + money context on their own projects, and the people
//     on those projects in the people-shaped reports — nothing about any other
//     project.
//   * Team Lead = their people everywhere, their projects as a PM.
//   * Admin sees everything.

export type ProjectRole = "member" | "team_lead" | "pm";

// Ordered so "at least this role" is a numeric comparison. Admin is not in here:
// it is a separate axis that satisfies every project-level check by override.
const RANK = {
	member: 1,
	team_lead: 2,
	pm: 3,
} satisfies Record<ProjectRole, number>;

export class AccessError extends UserFacingError {
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

// A caller's full authorization picture, resolved with four queries and then
// answered from memory. Services should resolve this ONCE per request and pass
// it down rather than re-querying per project, which is what turns a report over
// 40 projects into 40 role lookups.
export class Access {
	constructor(
		readonly userId: string,
		readonly organizationId: string,
		readonly isAdmin: boolean,
		private readonly roleByProject: ReadonlyMap<string, ProjectRole>,
		/** The people on the caller's list — empty for everyone who leads nobody. */
		private readonly leadOf: ReadonlySet<string> = new Set(),
		/** The org's projects with `openToOrg` set: trackable by every member,
		 *  assigned or not. Member rank only — nothing else reads it. */
		private readonly openProjects: ReadonlySet<string> = new Set(),
	) {}

	/** Whether the caller has a people list. There is no flag: a Team Lead is
	 *  somebody with at least one person on their list. */
	get isTeamLead(): boolean {
		return this.leadOf.size > 0;
	}

	/** The people on the caller's list. */
	peopleLed(): string[] {
		return [...this.leadOf];
	}

	/** Everything about one person — their time on every project, their
	 *  Tracking status, their time off. Themselves, the people on their list,
	 *  or Admin. */
	canViewPerson(userId: string): boolean {
		return this.isAdmin || userId === this.userId || this.leadOf.has(userId);
	}

	/** The rank an assignment grants. A Team Lead's OWN `team_lead` assignment
	 *  holds a project as a PM does; a `member` assignment never widens, list or
	 *  no list — the list makes someone a Team Lead, not a PM on every project
	 *  they happen to be tracking time on. */
	private rankOf(role: ProjectRole): number {
		return this.isTeamLead && role === "team_lead" ? RANK.pm : RANK[role];
	}

	/** The role the caller HOLDS a project as — `roleOn` after the Team Lead
	 *  rule, so a lead assigned as `team_lead` reads as PM here. A `member`
	 *  assignment is returned unchanged. What a screen should gate on; `roleOn`
	 *  is what the assignment row says. */
	heldAs(projectId: string): ProjectRole | null {
		const mine = this.roleByProject.get(projectId);
		if (mine == null) return null;
		return this.isTeamLead && mine === "team_lead" ? "pm" : mine;
	}

	// The caller's role on a project, or null when unassigned. Admins are NOT
	// synthesised into a role here — `isAdmin` is checked separately by each
	// capability, so an admin's actual assignment (or lack of one) stays visible
	// to callers that care, e.g. a "your projects" filter.
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
		return mine != null && this.rankOf(mine) >= RANK[role];
	}

	/** Every project id the caller holds at least `role` on. Admins get null,
	 *  meaning "unscoped — all projects", which callers translate into "no
	 *  project filter in the WHERE clause" rather than a 200-id IN list. */
	scopeFor(role: ProjectRole): string[] | null {
		if (this.isAdmin) return null;
		const ids = [...this.roleByProject.entries()]
			.filter(([, mine]) => this.rankOf(mine) >= RANK[role])
			.map(([projectId]) => projectId);
		if (role !== "member") return ids;
		// An open project holds everyone at Member rank, and at no rank above.
		return [...new Set([...ids, ...this.openProjects])];
	}

	// ── Capabilities (one method per row of the §4.1 matrix) ──────────────────

	/** Track own time. Requires an assignment of any role, or a project open to
	 *  the whole organization: people otherwise log time only on projects they
	 *  are assigned to, which keeps entry dropdowns short and the data clean. */
	canTrackOn(projectId: string): boolean {
		return (
			this.atLeast(projectId, "member") || this.openProjects.has(projectId)
		);
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

	/** Whether the caller may set a project role to `role`, or act on someone
	 *  who currently holds it — assign, change or remove. Admin is
	 *  unrestricted; everyone else is capped at their own held rank on the
	 *  project, so a Team Lead can staff or drop a plain Member but can
	 *  neither promote anyone (themselves included) to PM nor touch a PM or a
	 *  Team Lead who outranks their own assignment. `canManageProjectMembers`
	 *  only asks whether the caller may touch the roster at all; this is the
	 *  ceiling on what they may do to it once they can. */
	canActOnProjectRole(projectId: string, role: ProjectRole): boolean {
		if (this.isAdmin) return true;
		const held = this.heldAs(projectId);
		return held != null && RANK[role] <= RANK[held];
	}

	/** See the project's budget and hourly price. PM and Admin only — the two
	 *  money fields in the system are visible nowhere else. */
	canViewProjectMoney(projectId: string): boolean {
		return this.atLeast(projectId, "pm");
	}

	/** Manage a project — rename it, change its type or budget, archive it.
	 *  PM and Admin. */
	canManageProject(projectId: string): boolean {
		return this.atLeast(projectId, "pm");
	}

	/** Override/correct another person's Vacation or Sick Leave entries. PM of a
	 *  project the person is on, or Admin. (PMs never edit other people's regular
	 *  worked-time entries.) */
	canOverrideAbsenceFor(projectIds: string[]): boolean {
		if (this.isAdmin) return true;
		return projectIds.some((id) => this.atLeast(id, "pm"));
	}

	/** Create projects and clients. Anyone holding PM or Team Lead on at least
	 *  one project, plus Admins. */
	canCreateProjects(): boolean {
		if (this.isAdmin) return true;
		return [...this.roleByProject.values()].some(
			(role) => this.rankOf(role) >= RANK.team_lead,
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

	assertCanManageProject(projectId: string): void {
		if (!this.canManageProject(projectId)) {
			throw new AccessError("You cannot manage this project");
		}
	}

	assertCanCreateProjects(): void {
		if (!this.canCreateProjects()) {
			throw new AccessError("You cannot create projects");
		}
	}
}

export const accessService = {
	/** Resolve the caller's authorization picture. Four parallel queries, no N+1.
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
	 *  checked once here rather than re-asserted in each of those functions.
	 *
	 *  Runs through `ctxDb`, so it stays on the transaction when one is open —
	 *  `setWeekCell` reaches this via `create(txCtx, …)`. See ./db-ctx. */
	resolve: async (ctx: Ctx): Promise<Access> => {
		const client = ctxDb(ctx);
		const [membership, assignments, led, open] = await Promise.all([
			client.query.member.findFirst({
				where: and(
					eq(member.organizationId, ctx.organizationId),
					eq(member.userId, ctx.userId),
				),
				columns: { role: true },
			}),
			client
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
			client
				.select({ userId: teamLeadPerson.personUserId })
				.from(teamLeadPerson)
				.where(
					and(
						eq(teamLeadPerson.organizationId, ctx.organizationId),
						eq(teamLeadPerson.leadUserId, ctx.userId),
					),
				),
			client
				.select({ id: project.id })
				.from(project)
				.where(
					and(
						eq(project.organizationId, ctx.organizationId),
						eq(project.openToOrg, true),
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
			new Set(led.map((l) => l.userId)),
			new Set(open.map((p) => p.id)),
		);
	},

	/** The people whose time the caller may read in the reports that are about
	 *  PEOPLE rather than projects — Tracking, Absence, a person's total across
	 *  every project. Null for Admin (everyone). Otherwise themselves, the
	 *  people on their list, and everyone on the projects they hold as PM —
	 *  which, for a Team Lead, is only the projects where their OWN assignment
	 *  is `team_lead`; a plain `member` assignment does not add its project's
	 *  roster. One query at most, and only for somebody who manages a
	 *  project. */
	peopleScope: async (
		ctx: Ctx,
		access: Access,
	): Promise<Set<string> | null> => {
		if (access.isAdmin) return null;
		const people = new Set<string>([access.userId, ...access.peopleLed()]);
		const managed = access.scopeFor("pm") ?? [];
		if (managed.length > 0) {
			const rows = await ctxDb(ctx)
				.select({ userId: projectMember.userId })
				.from(projectMember)
				.where(
					and(
						eq(projectMember.organizationId, ctx.organizationId),
						inArray(projectMember.projectId, managed),
						eq(projectMember.active, true),
					),
				);
			for (const r of rows) people.add(r.userId);
		}
		return people;
	},

	/** Convenience for the many call sites that only need the global tier. */
	requireAdmin: async (ctx: Ctx): Promise<Access> => {
		const access = await accessService.resolve(ctx);
		access.assertAdmin();
		return access;
	},
};
