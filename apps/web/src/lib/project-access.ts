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
	/** Log time here — any assignment, or Admin. */
	canLogTime: boolean;
};

export const projectPageAccess = (
	isAdmin: boolean,
	heldRole: ProjectRole | null | undefined,
): ProjectPageAccess => {
	const lead = isAdmin || heldRole === "team_lead" || heldRole === "pm";
	return {
		canView: lead,
		canManageTeam: lead,
		canManageSettings: isAdmin || heldRole === "pm",
		canLogTime: isAdmin || heldRole != null,
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
