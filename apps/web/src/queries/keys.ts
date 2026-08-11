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
export const queryKeys = {
	access: ["access"],
	account: ["account"],
	clients: ["clients"],
	close: ["close"],
	compliance: ["compliance"],
	dayAssembly: ["day-assembly"],
	github: ["github"],
	googleCalendar: ["google-calendar"],
	holidays: ["holidays"],
	hourFund: ["hour-fund"],
	integrationSettings: ["integration-settings"],
	members: ["members"],
	notificationSettings: ["notification-settings"],
	notOnInvoice: ["not-on-invoice"],
	organization: ["organization"],
	projects: ["projects"],
	recurringBlockRules: ["recurring-block-rules"],
	reports: ["reports"],
	slack: ["slack"],
	tasks: ["tasks"],
	timeEntries: ["time-entries"],
	workingHours: ["working-hours"],
} as const satisfies Record<string, readonly [string]>;

export type QueryFamily = keyof typeof queryKeys;
