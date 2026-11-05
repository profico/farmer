/**
 * The workspace screens that only an admin may open. The lists in the More
 * tab already hide them from anybody else, but a link opens a screen without
 * the list, so the workspace layout checks the route too. The server checks
 * each read and each write again.
 *
 * `clients` is not here: a person who leads a project may open the list, and
 * the client sheet checks for an admin itself. `assistant` only redirects.
 */
export const ADMIN_SECTIONS: ReadonlySet<string> = new Set([
	"audit-log",
	"hour-fund",
	"integrations",
	"organization",
	"people",
	"reminders",
	"tasks",
	"webhooks",
]);

/** The workspace sections that every member may open. A new section must be
 *  in this set or in `ADMIN_SECTIONS`: a test fails for a section in none. */
export const MEMBER_SECTIONS: ReadonlySet<string> = new Set([
	"assistant",
	"clients",
]);

/** The route is an admin screen of the workspace. `segments` are the segments
 *  of the whole route, for example `["workspace", "people", "invite"]`. */
export const isAdminRoute = (segments: readonly string[]): boolean => {
	const [root, section] = segments;
	return root === "workspace" && section !== undefined
		? ADMIN_SECTIONS.has(section)
		: false;
};

export type AdminGate = "show" | "wait" | "redirect";

/** What the layout does with a route. A route that needs an admin waits
 *  until the capabilities are read, so that nothing of it shows before. */
export const adminGate = (
	segments: readonly string[],
	access: { ready: boolean; isAdmin: boolean },
): AdminGate => {
	if (!isAdminRoute(segments) || access.isAdmin) return "show";
	return access.ready ? "redirect" : "wait";
};
