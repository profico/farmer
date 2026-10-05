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

/** `GET /api/v1/orgs/$slug/organization/policy` — the Tracking rule and the
 *  automation lock, on Settings → Organization. Admins only. */
export type ApiOrgPolicy = {
	/** A total this share or less below the target so far is "slightly
	 *  behind", not "behind". The report and the reminders read it. */
	trackingTolerancePct: number;
	/** yyyy-MM-dd. The automations write nothing on or before it. Null for no
	 *  lock. */
	automationLockedThrough: string | null;
};

export const toApiOrgPolicy = (row: ApiOrgPolicy): ApiOrgPolicy => ({
	trackingTolerancePct: row.trackingTolerancePct,
	automationLockedThrough: row.automationLockedThrough,
});

/** `POST /api/v1/orgs/$slug/uploads` — the path of the stored image. Send it
 *  as the project's `icon` or the organization's `logo`: the upload itself
 *  changes nothing. */
export type ApiUploadedImage = { url: string };

/** `PATCH /api/v1/orgs/$slug/holidays` — the holiday as it is now. */
export type ApiHolidaySwitch = { name: string; disabled: boolean };
