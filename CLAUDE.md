# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Bun workspaces (`apps/*`, `packages/*`) orchestrated by Turborepo. Run from repo root unless noted.

```bash
bun install                 # installs all workspaces
bun run dev                 # turbo: starts apps/web (vite dev --port 3000, falls back to 3001+ if occupied — check the log's "Local:" line, don't assume 3000)
bun run build               # turbo: builds all workspaces
bun run test                # turbo: runs packages/core's bun test suite

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
bun run db:seed-tasks        # seeds the built-in absence tasks (Vacation, Sick Leave). Idempotent.
bun run db:seed              # demo data: one client/project/task. NOT idempotent, dev only.
bun run worker               # the standalone background worker (see Production)
bun test                     # the test suite (PGLite, no DATABASE_URL needed)
```

Linting is repo-wide and runs from the root:
```bash
bun run check                # biome check (lint + format + import order) — what CI runs
bun run typecheck            # turbo: tsc --noEmit in both workspaces — also what CI runs
bun run lint                 # biome lint only
bun run format               # biome format --write
```
`biome.json` at the root is the real config and covers **both** workspaces; `apps/web/biome.json` and `packages/core/biome.json` are three-line `{"root": false, "extends": "//"}` stubs so the same scripts work from inside either package. Biome is a root devDependency — don't add a second copy to a workspace, since two versions format differently and the drift is invisible until CI disagrees with your editor.

Fourteen `noNonNullAssertion` **warnings** are expected and do not fail the build: `process.env.X!` in the auth config and drizzle config, plus array-index assertions in two test files.

From `apps/web`:
```bash
bun run build                # vite build → dist/{client,server}, then prunes dist/client (see Gotchas)
bun run start                # bun run server.ts — the production host (see Production)
```

## Architecture

Two workspaces today — `apps/web` (TanStack Start/React) and `packages/core` (`@farmer/core`) — but the split is deliberate, not incidental: `packages/core` is written to also be reusable by a future `apps/api` and `apps/mcp` process.

**Boundary rule:** `packages/core` never imports TanStack/React. All business logic lives in `src/services/`, one file per aggregate. Every exported service function takes an explicit `ctx: { organizationId, userId }` (`src/services/types.ts`) as its first argument — **tenancy is a parameter, never ambient** — so the identical function is callable from a server function, a REST route, a background job, or (eventually) another process.

`packages/core` layout:
- `src/db/` — `drizzle-orm/postgres-js` client (`index.ts`) + schema split across:
  - `schema/auth.ts` — better-auth-owned (user/session/account/verification/organization/member/invitation). CLI-generated, see `auth:generate`.
  - `schema/domain.ts` — client, project, **task**, projectTask, projectMember, recurringBlockRule(+Skip), timeEntry.
  - `schema/people.ts` — memberProfile, memberTypeHistory (effective-dated person type).
  - `schema/schedule.ts` — memberSchedule, memberWorkingHoursDay, disabledHoliday.
  - `schema/close.ts` — monthlyClose, monthlyCloseRow.
  - `schema/settings.ts` — integrationSettings, syncedMeetingTombstone, commitFillTombstone, orgSettings, monthlyHourFund, notOnInvoiceStatusOption, notOnInvoiceEntry.
  - `schema/github.ts` — orgGithubInstallation, projectGithubRepo, timeEntryGithubCommit.
  - `schema/slack.ts` — slackInstallation, memberSlackIdentity, slackReminderLog.
  - `schema/notifications.ts` — pushSubscription, notificationSettings, projectBudgetAlert.
- `src/services/` — the domain layer. Aggregates: access, account, clients, close, compliance, day-assembly, github, google-calendar, holidays, hour-fund, integration-settings, members, not-on-invoice, notifications, org-settings, organization, projects, recurring-block-rules, report-pdf, reports, slack, tasks, time-entries, working-hours. Plus four shared, non-aggregate modules: `guards.ts`, `ledger.ts`, `unfiled.ts`, `notify.ts`.
- `src/schema/` — Zod input schemas, one module per aggregate, genuinely shared across three call sites: the RHF form resolver, the server function `.validator()`, and the `api/v1` REST handlers. Range inputs carry their own ceilings (62 days for a time-entry range, 366 for a report), so a caller cannot ask for a full-table scan by widening the dates. Don't re-validate by hand at a new call site — that is exactly how `api/v1/time-entries` ended up bypassing the 62-day cap.
- `src/lib/` — `time.ts` (UTC-in/display-zone-out duration + timezone helpers on `date-fns`/`@date-fns/tz`; the only place timezone math should happen), `working-day.ts`, `day-plan.ts`, `automation-window.ts`, `org-time.ts`, `org-country.ts`, `slug.ts`, `email.ts`, `http.ts`, `single-org.ts`, `oauth-state.ts`, the integration clients (`github-client.ts`, `google-calendar-client.ts`, `slack-client.ts`), and the report arithmetic the browser also needs: `utilization.ts`, `report-period.ts`, `report-format.ts` (`report-pdf.ts` re-exports them because it binds the native Typst compiler and so cannot be imported from a route).
- `src/jobs/` — background work; exported as `@farmer/core/jobs`. `scheduler.ts` is the runner, `worker.ts` a standalone process entry; `automation-sync.ts`, `log-reminders.ts`, `slack-reminders.ts`, `budget-alerts.ts` are one tick of work each.
- `src/test/harness.ts` — `createTestDb()` spins up an ephemeral **PGLite** (real Postgres, in-process WASM) and runs the migrations against it, then points the `db` proxy at it for the file's duration. Service tests need no DATABASE_URL, no container and no cleanup. `src/db/index.ts` resolves its handle lazily for this reason.

`apps/web` layout:
- `src/routes/` — TanStack Router file-based routing. `$orgSlug/route.tsx` is the org-scoped layout: its `beforeLoad` resolves the session, the organization and the caller's role in ONE server call (`enterOrganization`) alongside `getPublicAppConfig`, and redirects out if any check fails — every nested route inherits that guard. It was four sequential server-function round trips, one of them a session write that ran on every navigation; `enterOrganization` only repoints the session when the active org actually differs. Under it: `time/` (index/`week`/`month`), `projects/`, `reports.tsx`, `close.tsx`, and `settings/` (organization, members, my-schedule, clients, tasks, recurring-blocks, holidays, hour-fund, integrations, preferences). `login.tsx` is the sign-in entry point; `accept-invite/$invitationId.tsx` handles invitations; `no-access.tsx` breaks a redirect loop. `api/auth/$.ts` mounts better-auth; `api/login.ts` starts the Google flow; `api/github/setup.ts` and `api/slack/callback.ts` are OAuth redirect targets; `api/reports/pdf.ts` renders the PDF; `api/v1/*` are public REST read endpoints reusing the same services via `resolveApiOrgContext(request)`, which lives in `server/api-auth.ts` — deliberately NOT in `server/auth.ts`, see the client-bundle rule below. `reports.tsx` is the shell only; its eight tab bodies live in `components/reports/`.
- `src/server/` — thin `createServerFn` wrappers, one file per aggregate, mirroring `services/`. **Auth is attached via middleware** (`sessionMiddleware` / `orgMiddleware` / `orgAdminMiddleware` from `server/auth.ts`), read from the handler's `context` arg — not by calling `requireOrgContext()` inline. That makes the protection part of the function's declared shape rather than an easy-to-forget first line. Every file in `server/` uses them; `auth.ts` itself is the only place the bare helpers are called, because route `beforeLoad`s need them. `orgMiddleware` also re-checks membership against the database (see Authorization), and does so inside its `.server()` callback rather than in a shared helper — a top-level function body in `auth.ts` ships to the browser, so a deferred `import("@farmer/core/services")` there becomes a real client chunk of the services barrel, which now fails the build outright when it reaches the native typst binding.
- `src/queries/` — TanStack Query `queryOptions` factories, one per aggregate; routes prefetch via loaders, components read via `useSuspenseQuery`. `queries/keys.ts` holds the root of every key family, and **every key names its organization**: `queryKeys(orgSlug).timeEntries`, so factories take the slug as their first argument (`timeEntriesRangeQuery(orgSlug, from, to)`) and components get it from `useOrgSlug()`, loaders from `params.orgSlug`. Factories spread their root and invalidations name the same one, so a write and the query it stales cannot drift. Never write a bare `queryKey: ["…"]` literal on either side, and never drop the org — an org-blind key is an answer from the previous workspace, which is what the layout route used to carry twenty lines of QueryClient-stamping and staged cache-purging to compensate for. Server functions are deliberately NOT generated from a shared declaration — see `docs/adr/0001-no-server-function-generator.md`.
- `src/components/ui/` — shadcn on **Base UI** (`@base-ui/react`), not Radix (`components.json` style is `base-nova`). Composition uses the `render` prop, not `asChild`.

**Critical, non-obvious rule:** never put a static top-level `import ... from "@farmer/core/db"` / `"/auth"` / `"/services"` in any route or `src/server/*.ts` file. `postgres` touches `Buffer` at module scope, which crashes hydration in the browser — silently: forms fall back to native submission instead of throwing. Always import inside the handler body:
```ts
export const createTimeEntry = createServerFn({ method: "POST" })
  .middleware([orgMiddleware])
  .validator(createTimeEntryInput)
  .handler(async ({ data, context }) => {
    const { timeEntriesService } = await import("@farmer/core/services");
    return timeEntriesService.create(context.ctx, data);
  });
```
This is also why `requireOrgAdmin` routes through the `getMyRole` server function instead of importing services directly — it's called from a route `beforeLoad`, which also runs client-side during SPA navigation.

### Authorization

**Two independent axes, and `services/access.service.ts` is the only place that knows the matrix.**

- **One global role:** org Admin (better-auth's `member.role` = `owner` | `admin`, both mapping to the single Admin tier). There is deliberately no super-admin.
- **A per-assignment project role:** `member` | `team_lead` | `pm` on `projectMember`. The same person is PM on one project and a plain member on another, so a project role is never a property of the person.

**Membership is a precondition, not a capability.** `accessService.resolve` throws `NotAMemberError` when the caller has no membership row, rather than describing them as "nobody" (`isAdmin: false`, no assignments). That was the right answer to every project-level question and the wrong answer to "are they in the room" — a Ctx is built from `session.activeOrganizationId`, which is stamped on when the workspace is entered and never revisited, so an ex-member's Ctx stayed valid-looking until the session expired, and every org-wide read that only filters on `organizationId` (`clientsService.list`, `tasksService.list`, `orgSettingsService.get`) answered it. `orgMiddleware` and `resolveApiOrgContext` resolve `Access` at the boundary for the same reason, which also warms the request's memo.

`accessService.resolve(ctx)` returns an `Access` — two queries, then answered from memory. Resolve it **once per request** via `ctxAccess(ctx)` (`services/context.ts`), which memoizes it on the Ctx; before that memo existed it ran 66 times across the codebase, several times per request.

The lines that matter: Team Lead gets visibility and team management but **never money and never close**; PM adds close and the two money fields; a Member sees strictly their own entries. `scopeFor(role)` returns `null` for admins meaning "unscoped" — callers translate that into no project filter rather than a 200-id `IN` list, and an empty array is a real answer meaning "nothing". Admins are **not** synthesised into a project role: `roleOn()` returns their real assignment so the close sheet's "your projects" filter still works.

`server/auth.ts`'s `getMyAccess` flattens this for the client to gate UI with. It is **not** authorization — every service re-resolves `Access` server-side and asserts.

Two gates that read as one and are not: `assertTaskAvailable` (guards.ts) asks whether a TASK may be used on a project; `assertCanTrackOn` asks whether this PERSON may write there. Anything that creates time entries needs both. `recurringBlockRulesService` had only the first, so a rule could name any project in the org and then materialize real hours onto it.

### The month-end close

The anchor feature (`close.service.ts`), and the thing the numbers get invoiced from.

- One `monthlyClose` per project per month. Lifecycle: **Open → Submitted (PM) → Finalized (Admin)**. A PM may re-open and re-submit freely before finalization; an Admin may finalize even if the PM never submitted, and is the only one who may re-open a finalized month.
- Three columns per person: **Reported** (live sum of entries), **Adjusted** (the PM's reconciliation, null = displays as Reported), **Final** (Admin-only, null = displays as Adjusted). `effectiveAdjusted`/`effectiveFinal` are the fallback chain, and use `??` not `||` — an explicit zero is a real value.
- **Rows are a union**, not just the project's assignments: active assignments ∪ everyone who logged time on the project that month ∪ anyone already stored on the sheet. An unassigned contributor's hours silently falling off the sheet is a billing error.
- **Finalize snapshots Reported / Expected / Overtime.** Entries stay hand-editable in finalized months on purpose, so Reported keeps moving afterwards; the variance report compares Final against Reported *as it stood when Final was frozen*. Re-opening deliberately leaves the snapshots in place. Reads never create a close record — a month nobody touched simply reports as Open.
- **Finalize refuses while anyone has unfiled time.** The one hard stop: freezing a month while hours are unattributed means that time later lands on a month already closed against a number that predates it. Deliberately not enforced on `submit`, since only the person themselves can file their own time and blocking the PM would leave them stuck.
- **Expected** = `monthly fund − (absence days × 8h)`, and only on `product_team` projects. Null — never zero — when there's no fund yet or the person is a contractor without an override. `absenceDaysOverride` lives on the sheet only and never writes back to entries: divergence is the signal that someone forgot to log absence.

### The ledger

`services/ledger.ts` is the one definition of what counts as logged time. Fifteen hand-rolled `sum(durationSeconds) … groupBy` queries used to spell this out separately across reports, close, compliance and projects; three disagreed, visibly, in the UI.

What may vary between callers is the **projection** (columns, joins, grouping key). What must not vary is the **classification** and the tenancy/range predicate. So `ledgerWhere` owns the predicate and `LedgerScope` the vocabulary: `worked`, `project`, `unfiled`, `absence`, `all`. Callers with a bespoke projection compose `ledgerWhere` rather than being forced through a grouped API.

**Unfiled** = worked time with no project yet (a synced meeting, a commit fill block, an accepted assembly suggestion) — real work, not yet attributed, therefore a to-do. Absence is not unfiled (it never carries a project by definition), and neither is a project-less **Break** — nobody bills a client for lunch, so counting it nagged people to file something unfileable and blocked the close on it.

### Automation

**`jobs/automation-sync.ts` is where every entry nobody typed comes from** — recurring blocks, calendar meetings, commit work-time blocks. These used to run inside `timeEntriesService.listRange`, i.e. **on page load**, which meant a read did writes whose extent depended on whichever screen was open; scrolling the Month view back filed months of entries into already-closed timesheets. The per-user pass is `timeEntriesService.runAutomationsForUser`, and its **order is load-bearing**: a commit fill block is sized from what the day already holds, so recurring blocks must materialize first. It reports `ran`/`skipped`/`failed` separately — an engine whose window came back null did nothing, and folding that into success is what let "Sync now" claim it synced after touching nothing. The sweep runs `AUTOMATION_SYNC_CONCURRENCY` people at a time behind a per-person timeout.

**`lib/automation-window.ts` is the one window policy**, and the only place any of the three engines may learn how far it reaches: `to` is today in the **org** timezone (never the future — a row on a day nobody has lived counts in reports and gets rewritten underneath them), **or yesterday under `completeDaysOnly`**; `from` is the latest of `today - AUTOMATION_GRACE_DAYS`, the day the switch was flipped, and the day after `orgSettings.automationLockedThrough`. The `*_since` stamps alone were not enough: a stamp is a floor, not a window. Grace is a **downtime recovery budget**, not a backfill policy — every day inside the window is a day whose sync-owned rows can still be rewritten from the source. `completeDaysOnly` belongs to the commit engine alone: its block claims the rest of the working day and is sized from the day's *whole* target, so run against today a 09:15 commit produced a 7.5h block at 09:20 that `onConflictDoNothing` then froze.

**`automationLockedThrough` (org settings) locks the robots, not the people.** Entries stay hand-editable in finalized months on purpose, so this is deliberately narrower: the last day no *automation* may write to. Not made redundant by the short grace window — for the first days of every month that window reaches into the month just reconciled and invoiced. A single watermark rather than a per-month lock table. A failed read of it fails the whole pass rather than defaulting to unlocked.

**The commit engine attaches before it creates.** Commits are *evidence*: `syncCommitWorkTimeForRange` resolves a target per project (that project's work entry → the day's fill block → a project-less Development entry) and only files a rest-of-day block when commits found no home at all. Welding the two together meant a person who had already logged their day properly lost the commits entirely — the best-behaved case was the one that dropped data. Blank descriptions are backfilled from commit subjects; non-blank ones are never overwritten.

**`dayAssemblyService.suggest` takes `includeDismissed`** — the toggle that re-offers meetings and rest-of-day blocks the person deleted. Tombstones are what stop the engines rebuilding them, which is right by default and a dead end when the deletion was a mistake. Re-offered suggestions carry `dismissed: true` so the dialog renders them **unticked**.

Two engine details that differ and should stay differing: the MEETING path upserts with `onConflictDoUpdate … setWhere syncLocked = false`; `onConflictDoNothing` guards the COMMIT path.

### Tasks

The task taxonomy replaced the old "entry types". One global list per org (`scope: "organization"`) plus **site-scoped built-ins** shared by every org. Projects cherry-pick org tasks via `projectTask`; there is deliberately no project scope.

Engines resolve tasks by **`systemKey`**, never by name (`meeting`, `development`, `break`, `vacation`, `sick`). The old lookup matched `name = 'Development'`, so an org renaming the task silently switched the whole engine off — no block, no error. Names stay freely editable.

`guards.ts` treats any site-scoped non-absence task as universal — available on every project without being picked. Requiring an admin to add Meeting to each project meant forgetting it on one made that project unable to accept the calendar sync's own entries.

### Notifications

`services/notify.ts` — `notify(recipient, event)` is the single way anything tells a person anything. The recipient is always an `(organizationId, userId)` pair, so membership is checked on every channel; a `KINDS` table says which channels a kind uses and which `notificationSettings` column gates it. Adding a channel is one adapter plus one row in that table. Never throws — it returns which channels delivered. Substitutable via `setNotifyAdaptersForTests`. `notificationsService.sendPush` is the push *transport* and is not a call site: push subscriptions belong to a device, so nothing there can know which org is speaking.

### Ports and outbound calls

`services/ports.ts` — `calendarSource()` / `commitSource()`, the substitutable seam the sync engines read through. Production adapter is the real service; tests install an in-memory one via `setCalendarSourceForTests`.

**`lib/http.ts` (`externalFetch`) puts a deadline on every outbound call.** `fetch` has no default timeout, and the sweep awaits users behind a `running` flag that refuses a new tick while one is in flight — so one wedged socket to Google didn't degrade the sweep, it *ended* it silently until restart. `withTimeout` is the same idea one layer up.

### Authentication

**Google is the only identity, and there is no login page.** `emailAndPassword` is off, so there is no form to render and nothing to choose — "log in" is a redirect.

- **`routes/api/login.ts` is the sign-in surface.** A server route: it asks better-auth for the Google authorize URL and re-shapes that 200-plus-`Location` response into a real 302, copying the OAuth state/PKCE cookie across. Server-side rather than a client `authClient.signIn.social()` call so an unauthenticated document request reaches Google without the app hydrating at all.
- **`routes/login.tsx` stays a *page* route on purpose**, even though it renders almost never. Every `redirect({ to: "/login" })` and sign-out points at it, and a page route's `beforeLoad` runs both server-side and in the browser; `redirect({ href, reloadDocument: true })` turns either into the full-page hop `/api/login` needs.
- **The one time it renders is `?error=…`** — better-auth's `errorCallbackURL`, most usefully the single-org invite-only gate. That branch must not redirect, or an uninvited visitor bounces between `/login` and Google forever.
- **`prompt: "select_account"` on the google provider is deliberate.** With no login screen there is nowhere to offer "use a different account".
- `session.freshAge: 0` — better-auth 403s `SESSION_NOT_FRESH` on unlink-account once a session is older than a day, and this app has no step-up re-auth flow, so integration disconnects would break.
- Invite context rides through as query params and is rebuilt into the Google `callbackURL`. `redirect` is attacker-supplied in principle, so `api/login.ts` accepts only a same-site absolute path (`/…` but not `//…`).

### Integrations (GitHub + Google Calendar + Slack)

GitHub and Google Calendar are per-member and opt-in via `integrationSettings` (a missing row = every toggle off, so connecting an account never silently enables background sync); Slack is per-org and admin-only. All three live on `$orgSlug/settings/integrations`, which renders admin-only sections behind `role`.

- **GitHub uses two distinct credential types, don't conflate them.** The per-user OAuth account link (`socialProviders.github`) is used **only for identity** — it touches exactly two endpoints, `GET /user` (resolve the login, to filter commits by author) and `GET /user/installations` (enumerate installations the person may connect). All actual repo/commit reads go through a **per-org GitHub App installation token** (`orgGithubInstallation`), obtained after an admin installs the App and GitHub redirects to `api/github/setup.ts`, which re-verifies admin role and resolves the org from a signed `state` (`lib/oauth-state.ts`). Env: `GITHUB_CLIENT_ID/SECRET` (OAuth) are separate from `GITHUB_APP_ID/SLUG/PRIVATE_KEY` (the App; private key is base64-encoded PEM).
- **The `repo` scope on that OAuth app looks removable and is not.** It is a broad grant (read *and* write on every private repo the person can reach) that reads no repo content in this app, so it reads like a leftover — but GitHub documents `GET /user/installations` as working only for OAuth/classic tokens carrying `repo`, and that call is the authorization gate in `connectInstallation` (you may only attach an installation you actually administer). Removing it breaks GitHub App connection for anyone who links their account afterwards. The real fix, if the grant is ever judged too broad, is to issue a GitHub App *user access token* instead of using a classic OAuth app — a provider change, not a scope edit. The comment at the call site says all this; read it before touching the line.
- **Google Calendar** is a per-user grant scoped to `calendar.events`, and lives on a **separate `genericOAuth` provider (`"google-calendar"`)** rather than on the login provider — so signing in never demands calendar access, and a plain login row can't be mistaken for a live calendar connection. It needs `accessType: offline` + `prompt: consent` to get a refresh token, or reads break after the ~1h access token expires. `syncedMeetingTombstone` records meetings the user deleted post-sync; `commitFillTombstone` is the same idea per *day* for the commit engine's rest-of-day block, which previously had nothing but the one-fill-per-day index — an index the deletion itself cleared, so the block came straight back. Creating a fill block deliberately clears the tombstone, since that is a change of mind.
- **Slack** is one workspace per org (`slackInstallation`), installed by an admin through Slack's OAuth v2 flow. The bot token is written straight to the database — no client, form or validator ever handles it, and no server function returns it. The redirect URI is derived once in `slackRedirectUri()` because Slack byte-compares it across the two legs. Membership hooks (`afterAcceptInvitation`, `afterAddMember`) auto-match new people to Slack; `linkMember` swallows its own errors, so a Slack outage costs the match, not the membership. Env: `SLACK_CLIENT_ID/SECRET`.

### Single-organization mode

Setting `SINGLE_ORG_SLUG=<slug>` turns a deployment into a one-workspace, invite-only instance. Unset (the default) is the normal multi-tenant product, and every code path below is a no-op. It is a slug rather than a boolean so "which organization?" is never implicit — the only implicit answer available ("the oldest row") picks wrong on any database that already has two.

- **The switch is `packages/core/src/lib/single-org.ts`** — server-only. The client never reads the env var: `apps/web/src/server/config.ts` (`getPublicAppConfig`) hands it the mode plus the org's name/logo/slug. Deliberately **not** a `VITE_` variable — those bake at build time, and the Dockerfile builds one image meant to run under different environments.
- **The signup gate is a `databaseHooks.user.create.before` hook, not a screen.** Signing in with Google *is* the signup, and the user is created mid-OAuth-callback. The hook throws an `APIError` carrying a `code` — that field is load-bearing, since better-auth's OAuth callback only turns a thrown error into a redirect back to `errorCallbackURL` when one is set, and otherwise surfaces a raw 403 mid-round-trip.
- **Bootstrap: the first person to sign in on an unclaimed instance creates the org and owns it.** The race is settled by the unique index on `organization.slug`, not a read-then-write check.
- **`allowUserToCreateOrganization: false` + `disableOrganizationDeletion: true`** are what actually close those endpoints; hiding the switcher's "New organization" item is presentation.
- **URLs keep the `/$orgSlug` prefix.** Tenancy stays an explicit parameter, matching the service-layer rule.
- **`/no-access` exists to break a redirect loop.** A signed-in user with no membership would otherwise bounce `/` → workspace → `/` forever. It lists their live invitations through a local server fn, because better-auth's `listUserInvitations` rejects any caller whose email isn't verified, unconditionally, and this app has no verification flow.

### Production

Dev is `vite dev`. **Production is a Bun-native host, not Nitro/srvx**: `vite build` emits a web-standard `{ fetch }` handler with nothing to serve it, so `apps/web/server.ts` (TanStack's official start-bun reference) brings its own `Bun.serve` — static-asset preloading plus the in-process schedulers. `Dockerfile` builds and runs exactly this.

**This backend is a long-lived process, not a serverless function — background work goes in a job, never in a request handler.** The scheduler lives in `@farmer/core/jobs/scheduler.ts` rather than in `server.ts` so it can run three ways off one implementation:

| Where | How | Why |
|---|---|---|
| Production web host | `startSchedulers()` in `server.ts` | default; single instance |
| Development | `vite dev` spawns `packages/core/src/jobs/worker.ts` (the `farmer:dev-worker` plugin) | `vite dev` never loads `server.ts`, and nothing syncs on page load any more. Runs the **automation sweep only**: the other three jobs message real people and dev usually points at a shared database. `DEV_WORKER=false` to opt out |
| Separate worker container | `bun run worker` from `packages/core` | set `AUTOMATION_SYNC_ENABLED=false` (and friends) on the web host; run exactly one worker |

Each job is env-gated by `<NAME>_ENABLED` / `<NAME>_INTERVAL_MINUTES` — the full list is in the `scheduler.ts` header. All of it assumes a single instance; the jobs are idempotent, so a second replica is redundant rather than harmful. Note the tables in `scheduler.ts` are built by hoisted **functions**, not module-scope `const`s — that is load-bearing in the bundled image, and the header explains why.

## Testing

`bun test` from `packages/core` (or `bun run test` from the root). Runs against PGLite via `src/test/harness.ts` — real Postgres, real migrations, its own database per file. No DATABASE_URL, no container, no cleanup.

Two things the harness does *not* do, which fixtures must account for: it runs the migrations but **not** `db/seed-tasks.ts`, so Vacation/Sick Leave don't exist unless you insert them; and migration `0024` already seeds the site-scoped **Meeting** and **Break** tasks, so inserting those again violates `task_site_name_uidx` — look them up by `systemKey` instead.

Coverage is uneven, and worth knowing before you trust a green run.

Covered: `access`, `close`, `ledger`, `notify`, `org-settings`, `day-assembly`, `holidays`, `projects` (list scoping, money and stats redaction), `recurring-block-rules` (including its assignment gate), `guards` (tenancy), and `time-entries` across five files (`automation-since`, `commit-attach`, `copy-day`, `meeting-sync`, `time-entries.copy`), plus the automation sweep, the range ceilings in `src/schema/`, and the pure `lib/` arithmetic.

**Not covered at all:** `reports`, `compliance`, `hour-fund`, `not-on-invoice`, `members`, `tasks`, `github`, `slack`, `google-calendar`, `working-hours`, `organization`, `account`, `notifications`, `clients`, `integration-settings`, `report-pdf`. Changing any of those means the suite cannot tell you whether you broke them.

## Gotchas

- Bun does not walk up parent directories for `.env` in a workspace — `bun run` inside `packages/core` or `apps/web` won't see the root `.env`. Addressed by symlinking the root `.env` into each workspace package; do the same for any new workspace.
- **`vite build` emits server code into `dist/client`, and `server.ts` serves everything it finds there.** The deferred `await import("@farmer/core/services")` inside each server-fn handler is chunked by rolldown *before* the server-fn transform strips the handler, so the client build ends up with an orphan island — better-auth's config, the drizzle schema, `slack.service`, `notify` — that nothing imports and no route preloads, but which `server.ts`'s `**/*` glob happily publishes at `/assets/<hash>.js`. `apps/web/scripts/prune-client-assets.ts` runs as the second half of `bun run build` and deletes it. **It currently prunes nothing** — the island came in through `resolveApiOrgContext`'s deferred `import("@farmer/core/auth")` sitting at the top level of `server/auth.ts`, a module the browser bundle pulls in for its middleware, and moving that function to `server/api-auth.ts` (imported only by server routes) closed the last path. Keep the script: it is the detector, it prints what it removed, and the leak returns the moment a client-reachable module gains a deferred server import. It computes reachability from what the server build can actually name and aborts the build rather than guess — don't "simplify" it into an unconditional delete, and don't drop it from the `build` script.
- `timeEntriesService.listRange` still performs writes on read — it recomputes (and drops) each day's fill block against the rows just read. That is deliberate and commented, but it means a GET is not idempotent, including through `api/v1`.
- **The two reminder jobs rebuild org-level state per member.** `log-reminders.ts` and `slack-reminders.ts` construct a fresh `Ctx` inside their `for (const row of rows)` loop, so every org-scoped read inside it — `orgCountry`, the disabled-holiday set, org settings — runs once *per person* rather than once per org. `holidaysService` now memoizes the `date-holidays` instance per country, which removes the parsing cost, but the queries remain. Hoisting them per org is the real fix; it wasn't done because it means restructuring the loop in two jobs that message real people.
- The `nitro-nightly` package and `.bin/nitro` symlink present in `node_modules` are dead leftovers from initial scaffolding, not wired into `vite.config.ts`. The build has no hosting preset at all; production is served by the hand-written `apps/web/server.ts`, which is *why* one is needed.
- Base UI shadcn components have runtime-only failure modes that typecheck/build/lint all miss: `<Button render={<Link/>}>` to a non-`<button>` element needs `nativeButton={false}` or it throws in the console; `<Select>` needs an `items={[{value, label}]}` prop or the trigger displays the raw value instead of the resolved label.
- Always verify interactive changes in a real browser, not curl/SSR output — the hydration crash described above passed every curl-based check while silently breaking every form in the app. A headless Chromium is available via `playwright-core` + system `google-chrome` if no browser tool is otherwise configured.

## Agent skills

### Issue tracker

Issues live in the `profico/farmer` GitHub Issues, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one root `CONTEXT.md` plus `docs/adr/`. Neither `CONTEXT.md` nor a `CONTEXT-MAP.md` exists yet; that is expected, and their absence should not be flagged. See `docs/agents/domain.md`.
