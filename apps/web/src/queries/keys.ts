// The root of every query-key family, in one place.
//
// A query key and the invalidation that stales it are one decision written in
// two files, and until now the second half was written as a bare string literal
// at the call site — `invalidateQueries({ queryKey: ["time-entries"] })`,
// twelve times. Nothing connected those literals to the factories they were
// meant to match, so the connection was maintained by prose. From
// `queries/time-entries.ts`:
//
//     // Kept under the "time-entries" key prefix so the existing
//     // invalidations on write already refresh it
//
// That comment is the invariant. A new factory that forgot it, or a family
// renamed on one side only, produces a screen that silently shows stale data
// after a write — nothing throws, nothing fails to compile, and the bug looks
// like "sometimes you have to refresh".
//
// Every factory now spreads its root from here and every invalidation names the
// same root, so the two sides cannot drift: renaming a family is one edit, and
// deleting one is a type error at both ends.
//
// ── Why the org is in the key ───────────────────────────────────────────────
//
// Because a cached answer belongs to one workspace and nothing about
// `["projects"]` said which. The server functions behind these queries resolve
// their organization from the session, never from the key, so two workspaces
// produced identical keys over different data — and the cache outlives a
// workspace switch.
//
// That used to be handled a layer up, in `$orgSlug/route.tsx`: the org id was
// stamped onto the QueryClient instance, compared on every navigation, and a
// mismatch triggered a partial purge (`removeQueries({type: "inactive"})` and
// then an invalidate-everything) carefully staged so the outgoing page did not
// re-render against a dead cache mid-transition. Twenty lines of route code and
// twenty of comment, all of it compensating for a key that omitted the one fact
// that decides whether an entry is valid. Naming the org makes the old org's
// entries unreachable rather than dangerous, so there is nothing to purge and
// nothing to time correctly.
//
// The slug rather than the id: it is in the route params, so every loader and
// every component under `/$orgSlug` already has it without a fetch, and it is
// as unique as the id. Renaming a workspace re-keys its cache, which is a free
// refetch of data whose org just changed name.
export const queryKeys = (org: string) =>
	({
		access: ["access", org],
		account: ["account", org],
		assistant: ["assistant", org],
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
		organization: ["organization", org],
		projects: ["projects", org],
		recurringBlockRules: ["recurring-block-rules", org],
		reminderSettings: ["reminder-settings", org],
		reports: ["reports", org],
		rewind: ["rewind", org],
		slack: ["slack", org],
		tasks: ["tasks", org],
		timeEntries: ["time-entries", org],
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
} as const satisfies Record<string, readonly [string]>;
