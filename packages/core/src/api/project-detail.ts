/**
 * One project's page, as the REST API answers it.
 *
 * `projectsService.get` already decides what the caller may see. It sets the
 * three money fields to null for anyone below PM rank, and for a plain member
 * it sums the figures from the member's own entries only. The projection keeps
 * that decision and adds nothing to it: no field here is read from a column
 * that the service did not already filter.
 */

import type { ProjectOverview } from "../services/projects.service";
import type { ApiProjectRole } from "./me";

/** `GET …/projects/$id`. */
export type ApiProjectDetail = {
	id: string;
	name: string;
	code: string | null;
	/** An emoji, or null. */
	icon: string | null;
	/** `product_team`, `fixed_scope`, `hourly`, `maintenance` or `internal`. */
	type: string;
	/** `active` or `archived`. */
	status: string;
	/** Every member may log time here without an assignment. */
	openToOrg: boolean;
	client: { id: string; name: string };
	role: ApiProjectRole | null;
	/** Whose hours the figures sum: the whole project's (`project`), or only the
	 *  caller's own (`own`) for a person below Team Lead rank. */
	statsScope: "project" | "own";
	monthlyTotalSeconds: number;
	allTimeSeconds: number;
	contributorCount: number;
	/** PM and Admin only. Null for anyone else, and when not set. */
	budgetSeconds: number | null;
	/** PM and Admin only. A decimal string, for display. */
	budgetAmount: string | null;
	/** PM and Admin only. A decimal string, for display. */
	hourlyPrice: string | null;
};

export const toApiProjectDetail = (row: {
	id: string;
	name: string;
	code: string | null;
	icon: string | null;
	type: string;
	status: string;
	openToOrg: boolean;
	client: { id: string; name: string };
	myRole: ApiProjectRole | null;
	statsScope: "project" | "own";
	monthlyTotalSeconds: number;
	allTimeSeconds: number;
	contributorCount: number;
	budgetSeconds: number | null;
	budgetAmount: string | null;
	hourlyPrice: string | null;
}): ApiProjectDetail => ({
	id: row.id,
	name: row.name,
	code: row.code,
	icon: row.icon,
	type: row.type,
	status: row.status,
	openToOrg: row.openToOrg,
	client: { id: row.client.id, name: row.client.name },
	role: row.myRole,
	statsScope: row.statsScope,
	monthlyTotalSeconds: row.monthlyTotalSeconds,
	allTimeSeconds: row.allTimeSeconds,
	contributorCount: row.contributorCount,
	budgetSeconds: row.budgetSeconds,
	budgetAmount: row.budgetAmount,
	hourlyPrice: row.hourlyPrice,
});

/** `GET …/projects/$id/overview` — the all-time figures at the top of the
 *  project's page. Team Lead rank and up. */
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
