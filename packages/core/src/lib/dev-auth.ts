/**
 * Email + password sign-in, for local development only.
 *
 * Google is the only identity this app accepts in production (see
 * `src/auth/index.ts`), which is correct and also means a fresh checkout cannot
 * be logged into at all without a Google Cloud project, an OAuth consent screen
 * and two secrets — before the first page can be looked at, and again for every
 * throwaway account somebody wants to test a second role with. This switch
 * turns better-auth's `emailAndPassword` endpoints back on so that `bun run
 * dev` needs no third party.
 *
 * The gate is `NODE_ENV`, deliberately, and not an opt-in env var: an opt-in
 * flag is a thing you set once in a `.env` that then gets copied to a server,
 * and this is the one feature where that mistake is a second way into the
 * product.
 *
 * It fails CLOSED: only `development` and `test` turn it on. `vite dev` sets
 * `NODE_ENV=development` in its own process when nothing else has (the SSR
 * environment runs in that process, so server functions see it), and `bun
 * test` sets `test`. Everything else — `production`, a typo, and above all an
 * unset `NODE_ENV` on a server somebody started by hand — keeps password
 * sign-in off. The earlier `!== "production"` gate failed open on exactly that
 * last case.
 *
 * SERVER ONLY — like `single-org.ts`, this reads `process.env`, so in the
 * browser it would read as "off" whatever the server thinks. The client learns
 * it from `getPublicAppConfig`.
 *
 * Read per call rather than captured at module scope, matching
 * `assistant-flag.ts`.
 */
export const isDevAuthEnabled = (): boolean =>
	process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
