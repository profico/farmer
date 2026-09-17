import type { MyAccess } from "#/server/auth.ts";

// What one person may do on one project's pages, from the role they HOLD it
// as — the service's `heldAs`, which already ranks a Team Lead's assignment
// as PM. The §4 matrix, read for the screen: a plain Member sees nothing at
// project level, not even the project's total hours; a Team Lead sees the
// page and runs the team; a PM also has the settings. The services re-check
// every one of these behind the write; this only decides what is worth
// rendering, and what a row in a list is a link to.

export type ProjectRole = "member" | "team_lead" | "pm";

export type ProjectPageAccess = {
	/** The page itself: everyone's entries, the strip, the team. */
	canView: boolean;
	canManageTeam: boolean;
	canManageSettings: boolean;
	/** Log time here — any assignment, a project open to everyone, or Admin. */
	canLogTime: boolean;
};

export const projectPageAccess = (
	isAdmin: boolean,
	heldRole: ProjectRole | null | undefined,
	openToOrg = false,
): ProjectPageAccess => {
	const lead = isAdmin || heldRole === "team_lead" || heldRole === "pm";

	return {
		canView: lead,
		canManageTeam: lead,
		canManageSettings: isAdmin || heldRole === "pm",
		canLogTime: isAdmin || heldRole != null || openToOrg,
	};
};

/** The role the caller holds a project as, from the flattened access the
 *  client carries — the same rule as the service's `heldAs`: a Team Lead
 *  holds any project they are on as a PM. */
export const heldRoleFrom = (
	me: MyAccess,
	projectId: string,
): ProjectRole | null => {
	const mine = me.projectRoles[projectId];

	if (mine == null) return null;

	return me.isTeamLead ? "pm" : mine;
};

// Mirrors `Access.canActOnProjectRole` in access.service.ts — the client-side
// half of the same ceiling, so the Team page never offers a control the
// service would refuse. Not authorization: the service re-checks this on
// every write, this only decides what is worth rendering as an option.
const RANK = {
	member: 1,
	team_lead: 2,
	pm: 3,
} satisfies Record<ProjectRole, number>;

/** Whether someone holding `heldRole` on a project may set a member's role to
 *  `role`, or act on a member who currently holds it — assign, change or
 *  remove. Admin is unrestricted; everyone else is capped at their own held
 *  rank, so a Team Lead can staff or drop a plain Member but neither promote
 *  anyone (themselves included) to PM nor touch a PM or a Team Lead who
 *  outranks their own assignment. */
export const canActOnProjectRole = (
	isAdmin: boolean,
	heldRole: ProjectRole | null | undefined,
	role: ProjectRole,
): boolean => {
	if (isAdmin) return true;

	return heldRole != null && RANK[role] <= RANK[heldRole];
};
