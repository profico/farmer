/**
 * Email + password sign-in, for local development only.
 *
 * In production a password is the first account's way in and nobody else's
 * (see `emailAndPassword` in `src/auth/index.ts`). That would make a fresh
 * checkout hard to use: a second account to test a role with would need a
 * Google Cloud project, an OAuth consent screen and two secrets. This switch
 * opens the password endpoints fully, so that `bun run dev` needs no third
 * party. A password signup still passes the registration gate
 * (`src/auth/registration.ts`).
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
