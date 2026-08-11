# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Bun workspaces (`apps/*`, `packages/*`) orchestrated by Turborepo. Run from repo root unless noted.

```bash
bun install                 # installs all workspaces
bun run dev                 # turbo: starts apps/web (vite dev --port 3000, falls back to 3001+ if occupied — check the log's "Local:" line, don't assume 3000)
bun run build               # turbo: builds all workspaces

# Database (packages/core, run through root turbo)
bun run db:generate         # drizzle-kit generate → packages/core/drizzle/*.sql
bun run db:migrate          # drizzle-kit migrate
bun run db:check            # packages/core/src/db/check.ts — `select 1` sanity check
bun run db:studio           # drizzle-kit studio
```

Package-local scripts not wired into the root turbo pipeline — run from `packages/core`:
```bash
bun run auth:generate        # regenerates src/db/schema/auth.ts from packages/core/src/auth/index.ts.
                              # auth.ts is CLI-owned — never hand-edit it. Run this after changing any
                              # better-auth plugin config (e.g. organization.schema.additionalFields),
                              # then db:generate + db:migrate.
bun run db:seed              # seeds one client/project/task
bun run db:seed-entry-types  # seeds default time-entry types
```

From `apps/web`:
```bash
bun run test                 # turbo: runs packages/core's bun test suite (apps/web has no tests yet,
                              # and no test script — add one back when it does)
bun run lint                 # biome lint
bun run format               # biome format
bun run check                # biome check (lint + format)
bun run build                # vite build → dist/{client,server}
bun run start                # bun run server.ts — the production host (see Production below)
```

## Architecture

Two workspaces today — `apps/web` (TanStack Start/React) and `packages/core` (`@farmer/core`) — but the split is deliberate, not incidental: `packages/core` is written to also be reusable by a future `apps/api` and `apps/mcp` process.

**Boundary rule:** `packages/core` never imports TanStack/React. All business logic lives in `src/services/*.service.ts`, one file per aggregate (clients, projects, time-entries, time-off, working-hours, recurring-block-rules, reports, members, entry-types, organization, holidays, plus the integration services github, google-calendar, integration-settings). Every exported service function takes an explicit `ctx: { organizationId, userId }` (`src/services/types.ts`) as its first argument — **tenancy is a parameter, never ambient** — so the identical function is callable from a server function, a REST route, a background job, or (eventually) another process.

`packages/core` layout:
- `src/db/` — `drizzle-orm/postgres-js` client (`index.ts`) + schema split across `schema/auth.ts` (better-auth-owned: user/session/account/verification/organization/member/invitation — CLI-generated, see `auth:generate` above), `schema/domain.ts` (client/project/task/timeEntryType/recurringBlockRule(+Skip)/timeEntry), `schema/schedule.ts` (memberSchedule/memberWorkingHoursDay/timeOffRequest), `schema/github.ts` (orgGithubInstallation/projectGithubRepo/timeEntryGithubCommit), `schema/settings.ts` (integrationSettings + syncedMeetingTombstone).
- `src/auth/index.ts` — better-auth config: `drizzleAdapter(db, { provider: "pg" })`, the `organization` plugin, GitHub + Google `socialProviders` (per-user account links — see Integrations), account linking (`trustedProviders`, `allowDifferentEmails`), `session.freshAge: 0` (no step-up re-auth flow, so integration disconnects mustn't 403 on a day-old session), and `databaseHooks` that auto-create an org + owner membership on signup and stamp `activeOrganizationId` onto new sessions.
- `src/services/` — the domain layer described above.
- `src/test/harness.ts` — `createTestDb()` spins up an ephemeral **PGLite** (real Postgres, in-process WASM) and runs the migrations against it, then points the `db` proxy at it for the duration of the file. Service tests need no DATABASE_URL, no container and no cleanup. `src/db/index.ts` resolves its handle lazily for this reason — it used to call `postgres(process.env.DATABASE_URL!)` at module scope, so importing any service opened a pool and made the layer unimportable in a test process.
- `src/services/ports.ts` — `calendarSource()` / `commitSource()`, the substitutable seam the write-on-read sync engines read through. Production adapter is the real service; tests install an in-memory one via `setCalendarSourceForTests`. Two adapters, so the seam is real rather than indirection.
- `src/jobs/` — background jobs that run outside a request (`meeting-sync.ts`); exported as `@farmer/core/jobs`. Driven in-process by the production `server.ts` scheduler, and idempotent so overlapping/missed ticks are harmless — asserted by `services/meeting-sync.test.ts`, not merely claimed. Note the two engines differ: the MEETING path upserts with `onConflictDoUpdate ... setWhere syncLocked = false`; `onConflictDoNothing` guards the COMMIT path.
- `src/schema/` — Zod input schemas, one module per aggregate, shared across the RHF form resolver, the server function `.validator()`, and the REST handler (one schema, three call sites).
- `src/lib/` — `time.ts` (UTC-in/display-zone-out duration + timezone helpers built on `date-fns`/`@date-fns/tz`; this is the only place timezone math should happen), plus `org-time.ts`, `org-country.ts`, `slug.ts`, `email.ts` (nodemailer/SMTP), and the integration clients `github-client.ts`, `oauth-state.ts` (signed org-id round-trip through the GitHub/Slack setup redirects), `google-calendar-client.ts`.

`apps/web` layout:
- `src/routes/` — TanStack Router file-based routing. `$orgSlug/route.tsx` is the org-scoped layout: its `beforeLoad` resolves session, active org (`setActiveOrgBySlug`), and role, and redirects out if any check fails — every nested route under `$orgSlug/` inherits that guard. Under it: `time/` (index/`week`/`month` calendar views sharing a `time/route.tsx` layout), `projects/`, `reports.tsx`, and `settings/` (organization, members, my-schedule, time-off, recurring-blocks, entry-types, holidays, integrations, preferences). `(auth)/` holds the public login/register pages; `accept-invite/$invitationId.tsx` handles org invitations. `api/auth/$.ts` mounts the better-auth handler; `api/github/setup.ts` is the GitHub App install/setup redirect target; `api/v1/*` are public REST read endpoints that reuse the exact same services via `resolveApiOrgContext(request)` instead of the ambient-cookie helpers.
- `src/server/` — thin `createServerFn` wrappers, one file per aggregate, mirroring `services/`. Resolve `ctx` via `requireOrgContext`/`requireOrgAdmin` (`server/auth.ts`).
- `src/queries/` — TanStack Query `queryOptions` factories wrapping the server functions, one per aggregate; routes prefetch via loaders, components read via `useSuspenseQuery`.
- `src/components/ui/` — shadcn on **Base UI** (`@base-ui/react`), not Radix (`components.json` style is `base-nova`). Composition uses the `render` prop, not `asChild`.

**Critical, non-obvious rule:** never put a static top-level `import ... from "@farmer/core/db"` / `"/auth"` / `"/services"` in any route or `src/server/*.ts` file. `postgres` touches `Buffer` at module scope, which crashes hydration in the browser — silently: forms fall back to native submission instead of throwing. Always do the import inside the handler body instead:
```ts
export const createTimeEntry = createServerFn({ method: "POST" })
  .validator(createTimeEntryInput)
  .handler(async ({ data }) => {
    const { timeEntriesService } = await import("@farmer/core/services");
    const ctx = await requireOrgContext();
    return timeEntriesService.create(ctx, data);
  });
```
This is also why `requireOrgAdmin` (`server/auth.ts`) routes through the `getMyRole` server function instead of importing services directly — it's called from a route `beforeLoad`, which also runs client-side during SPA navigation.

### Integrations (GitHub + Google Calendar)

Three external integrations. GitHub and Google Calendar are per-member and opt-in via `integrationSettings` (a missing row = every toggle off, so connecting an account never silently enables background sync); Slack is per-org and admin-only. All three live on `$orgSlug/settings/integrations` — the page renders admin-only sections behind `role`, rather than moving them to their own routes.

- **GitHub uses two distinct credential types, don't conflate them.** The per-user OAuth account link (`socialProviders.github`) is used **only for identity** — resolving the user's GitHub login to filter commits by author, and enumerating installations they may connect. All actual repo/commit reads go through a **per-org GitHub App installation token** (`orgGithubInstallation`), obtained after an org admin installs the App and GitHub redirects to `api/github/setup.ts`. That setup route re-verifies admin role and resolves the target org from a signed `state` (`lib/oauth-state.ts`). Env: `GITHUB_CLIENT_ID/SECRET` (OAuth) are separate from `GITHUB_APP_ID/SLUG/PRIVATE_KEY` (the App; private key is base64-encoded PEM).
- **Google Calendar** is a per-user OAuth link scoped to `calendar.events` (read+write: read meetings for autofill, write all-day events when approved time off is synced). It needs `accessType: offline` + `prompt: consent` to get a refresh token, or reads break after the ~1h access token expires. `syncedMeetingTombstone` records meetings the user deleted post-sync so the engine leaves them deleted instead of re-importing.
- **Slack** is one workspace per org (`slackInstallation`), installed by an admin through Slack's OAuth v2 flow: `slackService.installUrl` builds the authorize URL, Slack redirects to `api/slack/callback.ts`, which re-verifies admin role, resolves the org from the same signed `state` helper as GitHub, and exchanges the code for a bot token. The token is written straight to the database — no client, form or validator ever handles it, and no server function returns it. The redirect URI is derived once in `slackRedirectUri()` because Slack byte-compares it across the two legs. Env: `SLACK_CLIENT_ID/SECRET`.

### Single-organization mode

Setting `SINGLE_ORG_SLUG=<slug>` turns a deployment into a one-workspace, invite-only instance. Unset (the default) is the normal multi-tenant product, and every code path below is a no-op. It is a slug rather than a boolean so "which organization?" is never implicit — the only implicit answer available ("the oldest row") picks wrong on any database that already has two.

- **The switch is `packages/core/src/lib/single-org.ts`** — server-only (reads `process.env`, touches the db). The client never reads the env var: `apps/web/src/server/config.ts` (`getPublicAppConfig`) hands it the mode plus the org's name/logo/slug, and nothing else. Deliberately **not** a `VITE_` variable — those bake at build time, and the Dockerfile builds one image meant to run under different environments.
- **The signup gate is a `databaseHooks.user.create.before` hook, not a screen.** The register route is not the only way in — a direct `POST /api/auth/sign-up/email` and "Sign in with Google" (which creates a user on first use) both bypass it. The hook covers every provider in one place; the invite-only register screen is cosmetic and says so.
- **Bootstrap: the first person to register on an unclaimed instance creates the org and owns it.** The race is settled by the unique index on `organization.slug` (insert + `onConflictDoNothing` + `returning()`), not a read-then-write check.
- **`allowUserToCreateOrganization: false` + `disableOrganizationDeletion: true`** on the organization plugin are what actually close those endpoints; hiding the switcher's "New organization" item is presentation.
- **URLs keep the `/$orgSlug` prefix.** `/` and any other slug redirect to the one workspace rather than the routes being restructured — tenancy stays an explicit parameter, matching the service-layer rule, and there's only one routing shape to maintain.
- **`/no-access` exists to break a redirect loop.** A signed-in user with no membership (invite revoked, or an account predating the flag) would otherwise bounce `/` → workspace → `/` forever. It also lists their live invitations so they can accept one — reading them through a local server fn, because better-auth's own `listUserInvitations` rejects any caller whose email isn't verified, unconditionally, and this app has no verification flow.

### Production

Dev is `vite dev` (no port-binding server needed). **Production is a Bun-native host, not Nitro/srvx**: `vite build` emits a web-standard `{ fetch }` handler with nothing to serve it, so `apps/web/server.ts` (TanStack's official start-bun reference) brings its own `Bun.serve` — static-asset preloading + the in-process **meeting-sync scheduler** (`setInterval` → `runMeetingSyncOnce` from `@farmer/core/jobs`, env-gated by `MEETING_SYNC_ENABLED`/`_INTERVAL_MINUTES`, assumes a single instance). `Dockerfile` builds and runs exactly this (`bun run server.ts`); node_modules is copied into the runtime image because the SSR bundle externalizes real deps as bare imports.

## Gotchas

- Bun does not walk up parent directories for `.env` in a workspace — `bun run` inside `packages/core` or `apps/web` won't see the root `.env`. It's addressed by symlinking the root `.env` into each workspace package; do the same for any new workspace.
- The `nitro-nightly` package and `.bin/nitro` symlink present in `node_modules` are dead leftovers from initial scaffolding, not wired into `vite.config.ts`. The build has no hosting preset at all; production is served by the hand-written `apps/web/server.ts` (see Production above), which is *why* one is needed.
- Base UI shadcn components have runtime-only failure modes that typecheck/build/lint all miss: `<Button render={<Link/>}>` to a non-`<button>` element needs `nativeButton={false}` or it throws in the console; `<Select>` needs an `items={[{value, label}]}` prop or the trigger displays the raw value instead of the resolved label.
- Always verify interactive changes in a real browser, not curl/SSR output — the hydration crash described above passed every curl-based check while silently breaking every form in the app. A headless Chromium is available via `playwright-core` + system `google-chrome` if no browser tool is otherwise configured.

## Agent skills

### Issue tracker

Issues live in the `profico/farmer` GitHub Issues, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.
