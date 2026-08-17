import { useParams } from "@tanstack/react-router";

/**
 * The workspace the current screen belongs to, for keying its queries.
 *
 * Every query key names its organization (`queries/keys.ts`), and this is where
 * a component gets the name to pass. It reads the route param rather than the
 * route context's `organization.id` for two reasons: the param is what the URL
 * already carries, so it is available before `beforeLoad` has resolved
 * anything, and a component that renders under `/$orgSlug` cannot get a
 * different answer than the loader that prefetched its data (which uses
 * `params.orgSlug` for the same key).
 *
 * `from: "/$orgSlug"` is the layout route every workspace screen sits under, so
 * this is a type error rather than a runtime surprise in a component that does
 * not.
 */
export const useOrgSlug = (): string =>
	useParams({ from: "/$orgSlug" }).orgSlug;
