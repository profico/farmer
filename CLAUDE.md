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
- `src/db/` — `drizzle-orm/postgres-js` client (`index.ts`) + schema split across `schema/auth.ts` (better-auth-owned: user/session/account/verification/organization/member/invitation — CLI-generated, see `auth:generate` above), `schema/domain.ts` (client/project/task/timeEntryType/recurringBlockRule(+Skip)/timeEntry), `schema/schedule.ts` (memberSchedule/memberWorkingHoursDay/timeOffRequest), `schema/github.ts` (orgGithubInstallation/projectGithubRepo/timeEntryGithubCommit), `schema/settings.ts` (integrationSettings + syncedMeetingTombstone + commitFillTombstone).
- `src/auth/index.ts` — better-auth config: `drizzleAdapter(db, { provider: "pg" })`, the `organization` plugin, GitHub + Google `socialProviders` (per-user account links — see Integrations), account linking (`trustedProviders`, `allowDifferentEmails`), `session.freshAge: 0` (no step-up re-auth flow, so integration disconnects mustn't 403 on a day-old session), and `databaseHooks` that auto-create an org + owner membership on signup and stamp `activeOrganizationId` onto new sessions.
- `src/services/` — the domain layer described above.
- `src/test/harness.ts` — `createTestDb()` spins up an ephemeral **PGLite** (real Postgres, in-process WASM) and runs the migrations against it, then points the `db` proxy at it for the duration of the file. Service tests need no DATABASE_URL, no container and no cleanup. `src/db/index.ts` resolves its handle lazily for this reason — it used to call `postgres(process.env.DATABASE_URL!)` at module scope, so importing any service opened a pool and made the layer unimportable in a test process.
- `src/services/ports.ts` — `calendarSource()` / `commitSource()`, the substitutable seam the sync engines read through. Production adapter is the real service; tests install an in-memory one via `setCalendarSourceForTests`. Two adapters, so the seam is real rather than indirection.
- `src/services/notify.ts` — `notify(recipient, event)`, the single way anything tells a person anything. The recipient is always an `(organizationId, userId)` pair, so membership is checked on every channel; a `KINDS` table says which channels a kind uses and which `notificationSettings` column gates it. Adding a channel is one adapter plus one row in that table. Never throws — it returns which channels delivered (`wasDelivered`). Substitutable via `setNotifyAdaptersForTests`. `notificationsService.sendPush` is the push *transport* and is not a call site: push subscriptions belong to a device, so nothing there can know which org is speaking.
- `src/jobs/` — background jobs that run outside a request; exported as `@farmer/core/jobs`. `scheduler.ts` is the runner (interval loops + graceful stop) and `worker.ts` a standalone process entry; the rest are one tick of work each. Every job is idempotent so overlapping/missed ticks are harmless — asserted by `services/meeting-sync.test.ts`, not merely claimed. Note the two sync engines differ: the MEETING path upserts with `onConflictDoUpdate ... setWhere syncLocked = false`; `onConflictDoNothing` guards the COMMIT path.
- **`automation-sync.ts` is where every entry nobody typed comes from** — recurring blocks, calendar meetings, commit work-time blocks. These used to run inside `timeEntriesService.listRange`, i.e. **on page load**, which meant a read did writes whose extent depended on whichever screen was open; scrolling the Month view back filed months of entries into already-closed timesheets. Reads no longer sync at all. The per-user pass is `timeEntriesService.runAutomationsForUser`, and its **order is load-bearing**: a commit fill block is sized from what the day already holds, so recurring blocks must materialize first. It reports `ran`/`skipped`/`failed` separately — an engine whose window came back null did nothing, and folding that into success is what let "Sync now" claim it synced after touching nothing. The sweep runs `AUTOMATION_SYNC_CONCURRENCY` people at a time behind a per-person timeout; a serial sweep with no ceiling overran the tick at a few hundred members.
- **`src/lib/automation-window.ts` is the one window policy**, and it is the only place any of the three engines may learn how far it reaches: `to` is today in the **org** timezone (never the future — a row on a day nobody has lived counts in reports and gets rewritten underneath them), **or yesterday under `completeDaysOnly`**, `from` is the latest of `today - AUTOMATION_GRACE_DAYS`, the day the switch was flipped, and the day after `orgSettings.automationLockedThrough`. The `*_since` stamps alone were not enough: a stamp is a floor, not a window, so the longer a switch had been on the further back the engines wrote. Grace is a **downtime recovery budget**, not a backfill policy — every day inside the window is a day whose sync-owned rows can still be rewritten from the source. `completeDaysOnly` is the one ceiling and belongs to the commit engine alone: its block claims the rest of the working day and is sized from the day's *whole* target, so run against today a 09:15 commit produced a 7.5h block at 09:20 that `onConflictDoNothing` then froze. Today stays reachable on demand — Assemble my day proposes the same fill without writing it.
- **`automationLockedThrough` (org settings) locks the robots, not the people.** Entries stay hand-editable in finalized months on purpose (`monthlyCloseRow`'s finalization snapshots exist precisely because Reported keeps moving), so this is deliberately narrower: the last day no *automation* may write to. It is not made redundant by the short grace window — for the first days of every month that window reaches into the month just reconciled and invoiced, which is exactly the period nobody wants gaining hours. A single watermark rather than a per-month lock table, because "we've closed through July" is what anyone actually means. A failed read of it fails the whole pass rather than defaulting to unlocked.
- **The commit engine attaches before it creates.** Commits are *evidence*: `syncCommitWorkTimeForRange` resolves a target per project (that project's work entry → the day's fill block → a project-less Development entry) and only files a rest-of-day block when commits found no home at all. Welding the two together meant a person who had already logged their day properly got `computeDayFillSeconds() <= 0`, hit a `continue`, and lost the commits entirely — the best-behaved case was the one that dropped data. Blank descriptions are backfilled from commit subjects; non-blank ones are never overwritten.
- **`dayAssemblyService.suggest` takes `includeDismissed`** — the Assemble-my-day toggle that re-offers meetings and rest-of-day blocks the person deleted. Tombstones are what stop the engines rebuilding them, which is right by default and a dead end when the deletion was a mistake, since the assembler was the one screen whose job is "offer me what's missing". Re-offered suggestions carry `dismissed: true` so the dialog can render them **unticked**; `dismissedCount` is reported either way so the toggle only appears on a day that has something behind it. Recurring-break skips are deliberately out of scope — a skipped break is a rule adjusted for a day, not a row lost.
- **`src/lib/http.ts` (`externalFetch`) puts a deadline on every outbound call.** `fetch` has no default timeout, and the sweep awaits users behind a `running` flag that refuses a new tick while one is in flight — so one wedged socket to Google didn't degrade the sweep, it *ended* it silently until the process restarted. `withTimeout` is the same idea one layer up, used for the per-person ceiling and to bound the request-path "Sync now".
- `src/schema/` — Zod input schemas, one module per aggregate, shared across the RHF form resolver, the server function `.validator()`, and the REST handler (one schema, three call sites).
- `src/lib/` — `time.ts` (UTC-in/display-zone-out duration + timezone helpers built on `date-fns`/`@date-fns/tz`; this is the only place timezone math should happen), plus `org-time.ts`, `org-country.ts`, `slug.ts`, `email.ts` (nodemailer/SMTP), and the integration clients `github-client.ts`, `oauth-state.ts` (signed org-id round-trip through the GitHub/Slack setup redirects), `google-calendar-client.ts`. Report arithmetic that the browser also needs lives here rather than in the route: `utilization.ts` (the one definition of the org-wide percentage — a ratio of sums over measured people, not a mean of the rows), `report-period.ts` (month-key arithmetic + which days a Month/Week/Custom selection covers), `report-format.ts` (the hours/days/percent display forms shared by the reports screen, the CSV export and the PDF; `report-pdf.ts` re-exports them because it binds the native Typst compiler and so cannot be imported from a route).

`apps/web` layout:
- `src/routes/` — TanStack Router file-based routing. `$orgSlug/route.tsx` is the org-scoped layout: its `beforeLoad` resolves session, active org (`setActiveOrgBySlug`), and role, and redirects out if any check fails — every nested route under `$orgSlug/` inherits that guard. Under it: `time/` (index/`week`/`month` calendar views sharing a `time/route.tsx` layout), `projects/`, `reports.tsx`, and `settings/` (organization, members, my-schedule, time-off, recurring-blocks, entry-types, holidays, integrations, preferences). `login.tsx` is the sign-in entry point — see Authentication below; `accept-invite/$invitationId.tsx` handles org invitations. `api/auth/$.ts` mounts the better-auth handler; `api/login.ts` starts the Google flow; `api/github/setup.ts` is the GitHub App install/setup redirect target; `api/v1/*` are public REST read endpoints that reuse the exact same services via `resolveApiOrgContext(request)` instead of the ambient-cookie helpers.
- `src/server/` — thin `createServerFn` wrappers, one file per aggregate, mirroring `services/`. Resolve `ctx` via `requireOrgContext`/`requireOrgAdmin` (`server/auth.ts`).
- `src/queries/` — TanStack Query `queryOptions` factories wrapping the server functions, one per aggregate; routes prefetch via loaders, components read via `useSuspenseQuery`. `queries/keys.ts` holds the root of every key family: factories spread their root (`[...queryKeys.timeEntries, from, to]`) and invalidations name the same one, so a write and the query it stales cannot drift. Never write a bare `queryKey: ["…"]` literal on either side. Server functions themselves are deliberately NOT generated from a shared declaration — see `docs/adr/0001-no-server-function-generator.md`; the Start compiler matches `createServerFn(...).handler(...)` syntactically at top level, and wrapping it fails silently by shipping the handler to the browser.
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

### Authentication

**Google is the only identity, and there is no login page.** `emailAndPassword` is off in `packages/core/src/auth`, so there is no form to render and nothing to choose — "log in" is a redirect.

- **`routes/api/login.ts` is the sign-in surface.** A server route: it asks better-auth for the Google authorize URL (`auth.api.signInSocial({ …, asResponse: true })`) and re-shapes that 200-plus-`Location` response into a real 302, copying the OAuth state/PKCE cookie across. Server-side rather than a client `authClient.signIn.social()` call so an unauthenticated document request reaches Google without the app hydrating at all. It also short-circuits an already-signed-in visitor straight to their destination.
- **`routes/login.tsx` stays a *page* route on purpose**, even though it renders almost never. Every `redirect({ to: "/login" })`, `<Link to="/login">` and sign-out in the app points at it, and a page route's `beforeLoad` runs both on the server (document request) and in the browser (SPA navigation); `redirect({ href, reloadDocument: true })` turns either into the full-page hop `/api/login` needs. Making it a second server route would mean touching every call site.
- **The one time it renders is `?error=…`** — better-auth's `errorCallbackURL`, most usefully the single-org invite-only gate. That branch must not redirect, or an uninvited visitor bounces between `/login` and Google forever. It reuses `AuthSplitPanel`, so a single-org instance still says the error in its own name and logo.
- **`prompt: "select_account"` on the google provider is deliberate.** With no login screen there is nowhere to offer "use a different account", so a browser already signed into Google would otherwise pick one silently with no way back — worst on an invite-only instance, where the invitation is tied to one address.
- Invite context (`redirect`/`email`/`org`/`orgSlug`/`role`) rides through as query params and is rebuilt into the Google `callbackURL`. `redirect` is attacker-supplied in principle, so `api/login.ts` accepts only a same-site absolute path (`/…` but not `//…`).

### Integrations (GitHub + Google Calendar)

Three external integrations. GitHub and Google Calendar are per-member and opt-in via `integrationSettings` (a missing row = every toggle off, so connecting an account never silently enables background sync); Slack is per-org and admin-only. All three live on `$orgSlug/settings/integrations` — the page renders admin-only sections behind `role`, rather than moving them to their own routes.

- **GitHub uses two distinct credential types, don't conflate them.** The per-user OAuth account link (`socialProviders.github`) is used **only for identity** — resolving the user's GitHub login to filter commits by author, and enumerating installations they may connect. All actual repo/commit reads go through a **per-org GitHub App installation token** (`orgGithubInstallation`), obtained after an org admin installs the App and GitHub redirects to `api/github/setup.ts`. That setup route re-verifies admin role and resolves the target org from a signed `state` (`lib/oauth-state.ts`). Env: `GITHUB_CLIENT_ID/SECRET` (OAuth) are separate from `GITHUB_APP_ID/SLUG/PRIVATE_KEY` (the App; private key is base64-encoded PEM).
- **Google Calendar** is a per-user OAuth link scoped to `calendar.events` (read+write: read meetings for autofill, write all-day events when approved time off is synced). It needs `accessType: offline` + `prompt: consent` to get a refresh token, or reads break after the ~1h access token expires. `syncedMeetingTombstone` records meetings the user deleted post-sync so the engine leaves them deleted instead of re-importing; `commitFillTombstone` is the same idea per *day* for the commit engine's rest-of-day block, which previously had nothing but the one-fill-per-day index — an index the deletion itself cleared, so the block came straight back on the next tick. Creating a fill block deliberately clears the tombstone, since that is a change of mind.
- **Slack** is one workspace per org (`slackInstallation`), installed by an admin through Slack's OAuth v2 flow: `slackService.installUrl` builds the authorize URL, Slack redirects to `api/slack/callback.ts`, which re-verifies admin role, resolves the org from the same signed `state` helper as GitHub, and exchanges the code for a bot token. The token is written straight to the database — no client, form or validator ever handles it, and no server function returns it. The redirect URI is derived once in `slackRedirectUri()` because Slack byte-compares it across the two legs. Env: `SLACK_CLIENT_ID/SECRET`.

### Single-organization mode

Setting `SINGLE_ORG_SLUG=<slug>` turns a deployment into a one-workspace, invite-only instance. Unset (the default) is the normal multi-tenant product, and every code path below is a no-op. It is a slug rather than a boolean so "which organization?" is never implicit — the only implicit answer available ("the oldest row") picks wrong on any database that already has two.

- **The switch is `packages/core/src/lib/single-org.ts`** — server-only (reads `process.env`, touches the db). The client never reads the env var: `apps/web/src/server/config.ts` (`getPublicAppConfig`) hands it the mode plus the org's name/logo/slug, and nothing else. Deliberately **not** a `VITE_` variable — those bake at build time, and the Dockerfile builds one image meant to run under different environments.
- **The signup gate is a `databaseHooks.user.create.before` hook, not a screen.** There is no signup screen to put it on: signing in with Google *is* the signup, and the user is created mid-OAuth-callback. The hook is the only point every provider passes through. It throws an `APIError` carrying a `code` — that field is load-bearing, since better-auth's OAuth callback only turns a thrown error into a redirect back to `errorCallbackURL` when one is set, and otherwise surfaces a raw 403 mid-round-trip.
- **Bootstrap: the first person to sign in on an unclaimed instance creates the org and owns it.** The race is settled by the unique index on `organization.slug` (insert + `onConflictDoNothing` + `returning()`), not a read-then-write check.
- **`allowUserToCreateOrganization: false` + `disableOrganizationDeletion: true`** on the organization plugin are what actually close those endpoints; hiding the switcher's "New organization" item is presentation.
- **URLs keep the `/$orgSlug` prefix.** `/` and any other slug redirect to the one workspace rather than the routes being restructured — tenancy stays an explicit parameter, matching the service-layer rule, and there's only one routing shape to maintain.
- **`/no-access` exists to break a redirect loop.** A signed-in user with no membership (invite revoked, or an account predating the flag) would otherwise bounce `/` → workspace → `/` forever. It also lists their live invitations so they can accept one — reading them through a local server fn, because better-auth's own `listUserInvitations` rejects any caller whose email isn't verified, unconditionally, and this app has no verification flow.

### Production

Dev is `vite dev` (no port-binding server needed). **Production is a Bun-native host, not Nitro/srvx**: `vite build` emits a web-standard `{ fetch }` handler with nothing to serve it, so `apps/web/server.ts` (TanStack's official start-bun reference) brings its own `Bun.serve` — static-asset preloading plus the in-process schedulers. `Dockerfile` builds and runs exactly this (`bun run server.ts`); node_modules is copied into the runtime image because the SSR bundle externalizes real deps as bare imports.

**This backend is a long-lived process, not a serverless function — background work goes in a job, never in a request handler.** The scheduler lives in `@farmer/core/jobs/scheduler.ts` rather than in `server.ts` so it can run three ways off one implementation:

| Where | How | Why |
|---|---|---|
| Production web host | `startSchedulers()` in `server.ts` | default; single instance |
| Development | `vite dev` spawns `packages/core/src/jobs/worker.ts` (the `farmer:dev-worker` plugin) | `vite dev` never loads `server.ts`, and nothing syncs on page load any more — without this, dev has no automation at all. Runs the **automation sweep only**: the other three jobs message real people and dev usually points at a shared database. `DEV_WORKER=false` to opt out |
| Separate worker container | `bun run worker` from `packages/core` | set `AUTOMATION_SYNC_ENABLED=false` (and friends) on the web host; run exactly one worker |

Each job is env-gated by `<NAME>_ENABLED` / `<NAME>_INTERVAL_MINUTES` — the full list is in the `scheduler.ts` header. `AUTOMATION_SYNC_*` replaced the old `MEETING_SYNC_*` pair when that job grew to cover all three engines. All of it assumes a single instance; the jobs are idempotent, so a second replica is redundant rather than harmful.

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
