import type { WeekStartsOn } from "../lib/time";
import type { Access } from "../services/access.service";

/** The role a person holds on a project, as `Access.heldAs` answers it. */
export type ApiProjectRole = NonNullable<ReturnType<Access["heldAs"]>>;

/**
 * `GET /api/v1/me` — who the token belongs to, and where they may go.
 *
 * Asked before any organization is chosen, because a device-flow token has no
 * active organization to read. Organizations are listed by slug, since the slug
 * is what every other route takes.
 */
export type ApiMe = {
	user: { id: string; name: string; email: string };
	organizations: { slug: string; name: string }[];
};

/**
 * What the caller may do in one organization, decided by the server. A client
 * shows a section only when the capability is true. The route behind it still
 * checks the permission, so a wrong guess is a 403 and not a leak.
 */
export type ApiCapabilities = {
	isAdmin: boolean;
	/** Admin, or a PM or Team Lead on any project. Gates Clients. */
	canManageClients: boolean;
	/** Admin, or a PM or Team Lead on any project. Gates creating projects. */
	canManageProjects: boolean;
	/** The caller has people on a Team Lead list. */
	leadsPeople: boolean;
	/** Reports for everybody. Anyone else sees themselves and the people they
	 *  lead. */
	canSeeAllReports: boolean;
};

/** The capabilities, read from `Access` and nothing else. Each one reuses a
 *  rule the web app already applies. */
export const toApiCapabilities = (access: Access): ApiCapabilities => ({
	isAdmin: access.isAdmin,
	canManageClients: access.isAdmin || access.isLeadSomewhere,
	canManageProjects: access.canCreateProjects(),
	leadsPeople: access.isTeamLead,
	canSeeAllReports: access.isAdmin,
});

/**
 * `GET /api/v1/orgs/$slug/whoami` — the person inside one organization.
 *
 * `timezone` and `today` are here because the CLI resolves `yesterday`,
 * `friday` and the current week in the ORG's timezone, not the laptop's: a
 * person in another timezone logs against the organization's calendar, which is
 * what every report reads.
 */
export type ApiWhoami = {
	userId: string;
	name: string | null;
	email: string | null;
	organization: { slug: string; name: string };
	orgRole: string | null;
	isAdmin: boolean;
	capabilities: ApiCapabilities;
	timezone: string;
	/** yyyy-MM-dd in `timezone`, at the moment of the request. */
	today: string;
	/** The day the org's weeks start on: 1 = Monday, 0 = Sunday. The CLI's
	 *  `--week` and `copy-week` use it. */
	weekStartsOn: WeekStartsOn;
	/** Enabled days only. 0 = Sunday. `HH:mm`. */
	workingDays: { dayOfWeek: number; startTime: string; endTime: string }[];
	projects: { id: string; name: string; role: ApiProjectRole | null }[];
};
