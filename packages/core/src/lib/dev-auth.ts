/**
 * Email + password sign-in, for local development only.
 *
 * In production a password is the first account's way in and nobody else's
 * (see `emailAndPassword` in `src/auth/index.ts`). In development, a second
 * account for a role test would need a Google Cloud project and two secrets.
 * This switch opens the password endpoints fully, so `bun run dev` needs no
 * third party. A password signup still passes the registration gate
 * (`src/auth/registration.ts`).
 *
 * The gate is `NODE_ENV`, not an opt-in env var. An opt-in flag in a `.env`
 * can be copied to a server, and here that would be a second way into the
 * product.
 *
 * It fails closed: only `development` and `test` turn it on. `vite dev` sets
 * `NODE_ENV=development` in its own process when nothing else has, and `bun
 * test` sets `test`. Everything else keeps password sign-in off: `production`,
 * a typo, and an unset `NODE_ENV` on a server that somebody started by hand.
 * A `!== "production"` gate would fail open on that last case.
 *
 * Server only: it reads `process.env`, so in the browser it would read as
 * "off". The client learns it from `getPublicAppConfig`.
 *
 * Read per call rather than captured at module scope, matching
 * `assistant-flag.ts`.
 */
export const isDevAuthEnabled = (): boolean =>
	process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
