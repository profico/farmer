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
	timezone: string;
	/** yyyy-MM-dd in `timezone`, at the moment of the request. */
	today: string;
	/** Enabled days only. 0 = Sunday. `HH:mm`. */
	workingDays: { dayOfWeek: number; startTime: string; endTime: string }[];
	projects: { id: string; name: string; role: ApiProjectRole | null }[];
};
