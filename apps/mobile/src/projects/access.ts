/**
 * What one person may do on the screens of one project, from the role
 * that they hold on it. This is the rule of `lib/project-access.ts` in the
 * web app. It decides only what the screens show: the server checks each
 * read and each write again.
 *
 * `role` is the role that the server sends (`ProjectDetail.role`). It is
 * the held role: a Team Lead who leads the people of a project holds it as
 * a PM.
 */

export type ProjectRole = "member" | "team_lead" | "pm";

export const PROJECT_ROLES: {
	value: ProjectRole;
	label: string;
	hint: string;
}[] = [
	{ value: "member", label: "Member", hint: "Logs time on the project" },
	{
		value: "team_lead",
		label: "Team Lead",
		hint: "Holds the project as a PM does",
	},
	{ value: "pm", label: "PM", hint: "Manages the project and its team" },
];

/** The role in words. A role that this app does not know yet shows as the
 *  server names it. */
export const roleLabel = (role: string) =>
	PROJECT_ROLES.find((item) => item.value === role)?.label ?? role;

export const asProjectRole = (role: string | null): ProjectRole | null =>
	PROJECT_ROLES.find((item) => item.value === role)?.value ?? null;

export type ProjectPageAccess = {
	/** The page: the figures, the entries of the team, the team. */
	canView: boolean;
	canManageTeam: boolean;
	canManageSettings: boolean;
	/** Any assignment, a project open to everyone, or an admin. */
	canLogTime: boolean;
};

export const projectPageAccess = (
	isAdmin: boolean,
	role: string | null,
	openToOrg = false,
): ProjectPageAccess => {
	const lead = isAdmin || role === "team_lead" || role === "pm";
	return {
		canView: lead,
		canManageTeam: lead,
		canManageSettings: isAdmin || role === "pm",
		canLogTime: isAdmin || role !== null || openToOrg,
	};
};

const RANK = {
	member: 1,
	team_lead: 2,
	pm: 3,
} satisfies { [role in ProjectRole]: number };

/** True when a person who holds `held` may give `role` to somebody, or
 *  change or remove a person who has `role`. An admin may do all. Every
 *  other person stops at their own rank. */
export const canActOnProjectRole = (
	isAdmin: boolean,
	held: string | null,
	role: string,
) => {
	if (isAdmin) return true;
	const heldRole = asProjectRole(held);
	const target = asProjectRole(role);
	return heldRole !== null && target !== null && RANK[target] <= RANK[heldRole];
};
