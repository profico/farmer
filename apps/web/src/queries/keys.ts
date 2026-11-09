// The root of every query-key family, in one place.
//
// A query key and the invalidation that stales it are one decision. Every
// factory spreads its root from here, and every invalidation names the same
// root, so the two sides cannot drift. If they drift, a screen shows stale data
// after a write, and nothing throws. Renaming a family is one edit here, and
// deleting one is a type error at both ends.
//
// The org is in the key because a cached answer belongs to one workspace. The
// server functions resolve the organization from the session, not from the
// key, so without the org two workspaces would share keys over different data,
// and the cache outlives a workspace switch. With the org in the key, the old
// org's entries are unreachable and nothing needs a purge.
//
// The key uses the slug, not the id. Every loader and component under
// `/$orgSlug` has it from the route params, and it is as unique as the id. A
// workspace rename re-keys the cache, which costs one refetch.
export const queryKeys = (org: string) =>
	({
		access: ["access", org],
		account: ["account", org],
		assistant: ["assistant", org],
		audit: ["audit", org],
		clients: ["clients", org],
		compliance: ["compliance", org],
		dayAssembly: ["day-assembly", org],
		filingRules: ["filing-rules", org],
		github: ["github", org],
		googleCalendar: ["google-calendar", org],
		harvestImport: ["harvest-import", org],
		holidays: ["holidays", org],
		hourFund: ["hour-fund", org],
		integrationSettings: ["integration-settings", org],
		members: ["members", org],
		notificationSettings: ["notification-settings", org],
		appReach: ["app-reach", org],
		organization: ["organization", org],
		projects: ["projects", org],
		recurringBlockRules: ["recurring-block-rules", org],
		reminderSettings: ["reminder-settings", org],
		reports: ["reports", org],
		rewind: ["rewind", org],
		slack: ["slack", org],
		tasks: ["tasks", org],
		timeEntries: ["time-entries", org],
		timer: ["timer", org],
		webhooks: ["webhooks", org],
		workingHours: ["working-hours", org],
	}) as const satisfies Record<string, readonly [string, string]>;

export type QueryFamily = keyof ReturnType<typeof queryKeys>;

/**
 * The instance's own families, which name no organization because they belong
 * to no organization.
 *
 * The rule above — every key names its workspace — exists because a cached
 * answer belongs to one workspace and the server resolves that workspace from
 * the session rather than from the key. Neither half is true here: who operates
 * the DEPLOYMENT is one answer for the whole instance, the same under every
 * slug, and the server functions behind these keys take no organization at all
 * (`server/platform-admins.ts`). Adding a slug would not make the key safer, it
 * would cache the same answer once per workspace and stale it in one of them.
 *
 * Kept in this file rather than written as a literal at the call site, for the
 * reason the header gives: an invalidation and a key are one decision.
 */
export const platformKeys = {
	admins: ["platform-admins"],
	people: ["platform-people"],
	settings: ["instance-settings"],
	oauthProviders: ["instance-oauth-providers"],
} as const satisfies Record<string, readonly [string]>;
