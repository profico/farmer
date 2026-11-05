// The keys that a change makes stale, as plain functions. A hook calls one of
// them with the query client and the workspace scope (`scope(w)` of
// `queries.ts`). They hold no React and no session, so a test can run them
// against a fake client and read the keys.

/** The part of the query client that these functions use. */
export type Invalidator = {
	invalidateQueries(filter: {
		queryKey: readonly string[];
		exact?: boolean;
	}): Promise<void>;
};

/** The key every query of one workspace starts with. */
export type Scope = readonly string[];

type KeyParts = readonly (readonly string[])[];

const invalidateParts = (client: Invalidator, base: Scope, parts: KeyParts) =>
	Promise.all(
		parts.map((part) =>
			client.invalidateQueries({ queryKey: [...base, ...part] }),
		),
	);

/** Every query of the workspace: the days, the reports, the projects, the
 *  admin lists and `whoami`. */
const WORKSPACE_WIDE: KeyParts = [[]];

/** The days, the reports, the hours on the project list, and the timer. A
 *  timer that continues an entry reads its project, task and note live from
 *  the entry (#133). */
const TIME_KEYS = [
	"entries",
	"unfiled",
	"tracking",
	"home",
	"reports",
	"projects",
	"timer",
] as const;

export const afterTimeChange = (client: Invalidator, base: Scope) =>
	Promise.all(
		TIME_KEYS.map((key) =>
			client.invalidateQueries({
				queryKey: [...base, key],
				exact: key === "timer",
			}),
		),
	);

/** A person's role, type, start date or team changes the reports that count
 *  them, the working days and the capabilities, so the whole workspace is
 *  stale. */
export const afterPeopleChange = (client: Invalidator, base: Scope) =>
	invalidateParts(client, base, WORKSPACE_WIDE);

/** The timezone and the first day of the week set the range of every week
 *  and every report, so the whole workspace is stale. `/me` carries the name
 *  in the workspace switcher. */
export const afterOrganizationChange = (
	client: Invalidator,
	base: Scope,
	meKey: Scope,
) =>
	Promise.all([
		invalidateParts(client, base, WORKSPACE_WIDE),
		client.invalidateQueries({ queryKey: meKey }),
	]);

/** `["clients"]` is the list of the project form and of the projects screen,
 *  apart from the admin list. A client name is a row of the reports. */
export const afterClientChange = (client: Invalidator, base: Scope) =>
	invalidateParts(client, base, [
		["admin", "clients"],
		["clients"],
		["projects"],
		["reports"],
	]);

/** A task name shows in the days, the reports and the timer. */
export const afterTaskChange = (client: Invalidator, base: Scope) =>
	Promise.all([
		invalidateParts(client, base, [["admin", "tasks"], ["tasks"]]),
		afterTimeChange(client, base),
	]);

/** The reminders show whether Slack is connected. */
export const afterSlackDisconnect = (client: Invalidator, base: Scope) =>
	invalidateParts(client, base, [["admin", "reminders"]]);

/** Wait for every promise, then throw the first failure. A failure of one
 *  does not stop the others. */
export const settleAll = async (work: readonly Promise<unknown>[]) => {
	const results = await Promise.allSettled(work);
	for (const result of results) {
		if (result.status === "rejected") throw result.reason;
	}
};
