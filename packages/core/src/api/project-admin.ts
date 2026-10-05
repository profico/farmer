/**
 * The project screens of a PM and a team lead: a project with its stats and
 * money, its overview strip and its team.
 *
 * The service decides what a caller may see. `enrichedProjects` already sets
 * the money to null for a person who may not see it, and it sums only the
 * caller's own hours when they may not see the project's hours. These
 * projections pass those values through unchanged and add nothing.
 */

import type { ProjectOverview } from "../services/projects.service";
import { type ApiProject, toApiProject } from "./catalogue";
import type { ApiProjectRole } from "./me";

/** Whose hours the stats sum: the whole project's, or only the caller's. */
export type ApiStatsScope = "project" | "own";

export type ApiProjectStats = {
	scope: ApiStatsScope;
	/** This month, in the organization's timezone. */
	monthSeconds: number;
	allTimeSeconds: number;
	/** The active team. Empty when `scope` is `own`. */
	contributorCount: number;
	/** At most five names. */
	contributors: { id: string; name: string }[];
};

/**
 * `GET /api/v1/orgs/$slug/projects` and one project. The three money fields
 * are null for a person who may not see them, not only empty.
 */
export type ApiProjectDetail = ApiProject & {
	type: string;
	icon: string | null;
	openToOrg: boolean;
	budgetSeconds: number | null;
	budgetAmount: string | null;
	hourlyPrice: string | null;
	stats: ApiProjectStats;
};

export const toApiProjectDetail = (row: {
	id: string;
	name: string;
	code: string | null;
	status: string;
	type: string;
	icon: string | null;
	openToOrg: boolean;
	budgetSeconds: number | null;
	budgetAmount: string | null;
	hourlyPrice: string | null;
	client: { id: string; name: string };
	myRole: ApiProjectRole | null;
	statsScope: ApiStatsScope;
	monthlyTotalSeconds: number;
	allTimeSeconds: number;
	contributorCount: number;
	contributors: { id: string; name: string }[];
}): ApiProjectDetail => ({
	...toApiProject(row),
	type: row.type,
	icon: row.icon,
	openToOrg: row.openToOrg,
	budgetSeconds: row.budgetSeconds,
	budgetAmount: row.budgetAmount,
	hourlyPrice: row.hourlyPrice,
	stats: {
		scope: row.statsScope,
		monthSeconds: row.monthlyTotalSeconds,
		allTimeSeconds: row.allTimeSeconds,
		contributorCount: row.contributorCount,
		contributors: row.contributors.map((person) => ({
			id: person.id,
			name: person.name,
		})),
	},
});

/** `GET /api/v1/orgs/$slug/projects/$id/overview` — the strip at the top of
 *  a project's page. A PM or team lead on the project, or an admin. Its own
 *  type, so a field added to `ProjectOverview` does not reach the API. */
export type ApiProjectOverview = {
	allTimeSeconds: number;
	entryCount: number;
	/** Distinct people who ever logged time here. Not the roster. */
	peopleCount: number;
	firstEntry: string | null;
	lastEntry: string | null;
	overtimeSeconds: number;
	monthSeconds: number;
	monthPeople: number;
};

export const toApiProjectOverview = (
	row: ProjectOverview,
): ApiProjectOverview => ({
	allTimeSeconds: row.allTimeSeconds,
	entryCount: row.entryCount,
	peopleCount: row.peopleCount,
	firstEntry: row.firstEntry,
	lastEntry: row.lastEntry,
	overtimeSeconds: row.overtimeSeconds,
	monthSeconds: row.monthSeconds,
	monthPeople: row.monthPeople,
});

/** One row of a project's team. An inactive row is a person who was removed
 *  and keeps their history. */
export type ApiProjectMember = {
	userId: string;
	name: string;
	email: string;
	role: "member" | "team_lead" | "pm";
	active: boolean;
	allTimeSeconds: number;
	/** The last day they logged on the project, yyyy-MM-dd. */
	lastEntry: string | null;
};

export const toApiProjectMember = (
	row: ApiProjectMember,
): ApiProjectMember => ({
	userId: row.userId,
	name: row.name,
	email: row.email,
	role: row.role,
	active: row.active,
	allTimeSeconds: row.allTimeSeconds,
	lastEntry: row.lastEntry,
});

/** A person named in a list: a team picker, a team lead's people. */
export type ApiPersonRef = { userId: string; name: string; email: string };

export const toApiPersonRef = (row: ApiPersonRef): ApiPersonRef => ({
	userId: row.userId,
	name: row.name,
	email: row.email,
});
