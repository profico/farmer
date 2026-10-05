/**
 * The admin screens of a workspace that the mobile app shows: the task list,
 * the hour fund and the organization's own settings. Admins only, and the
 * routes check that.
 */

import type { WeekStartsOn } from "../lib/time";
import { type ApiTask, toApiTask } from "./catalogue";

/** `GET /api/v1/orgs/$slug/tasks/managed` — one row of Settings → Tasks:
 *  the built-ins and the organization's own tasks, archived ones too. */
export type ApiManagedTask = ApiTask & {
	/** `site` for a built-in, which cannot be changed or archived. */
	scope: string;
	color: string | null;
	description: string | null;
	/** ISO 8601, or null for a live task. */
	archivedAt: string | null;
	/** The organization's entries on the task. */
	entryCount: number;
};

export const toApiManagedTask = (row: {
	id: string;
	name: string;
	group: string;
	isAbsence: boolean;
	systemKey: string | null;
	scope: string;
	color: string | null;
	description: string | null;
	archivedAt: Date | null;
	entryCount: number;
}): ApiManagedTask => ({
	...toApiTask(row),
	scope: row.scope,
	color: row.color,
	description: row.description,
	archivedAt: row.archivedAt?.toISOString() ?? null,
	entryCount: row.entryCount,
});

/** One month of the hour fund. A month with no row has no fund, which is
 *  not the same as a fund of zero. */
export type ApiHourFundMonth = {
	year: number;
	month: number;
	fundSeconds: number;
};

export const toApiHourFundMonth = (
	row: ApiHourFundMonth,
): ApiHourFundMonth => ({
	year: row.year,
	month: row.month,
	fundSeconds: row.fundSeconds,
});

/** `GET /api/v1/orgs/$slug/hour-fund/suggestion` — the weekdays of a month
 *  that are not public holidays, at 8 hours each. Never stored by itself. */
export type ApiHourFundSuggestion = {
	workingDays: number;
	fundSeconds: number;
};

/** `GET /api/v1/orgs/$slug/organization` — Settings → Organization. */
export type ApiOrganizationSettings = {
	name: string;
	/** ISO 3166-1 alpha-2. It picks the public holidays. */
	country: string;
	timezone: string;
	weekStartsOn: WeekStartsOn;
	/** A URL or the path of an uploaded image, or null. */
	logo: string | null;
};

export const toApiOrganizationSettings = (
	row: ApiOrganizationSettings,
): ApiOrganizationSettings => ({
	name: row.name,
	country: row.country,
	timezone: row.timezone,
	weekStartsOn: row.weekStartsOn,
	logo: row.logo,
});
