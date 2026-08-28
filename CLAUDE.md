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
bun run db:seed-assistant-ui # a "UI kitchen sink" assistant thread: every renderer construct plus a
                              # suspended approval, hand-written so no model call is spent. Idempotent
                              # by title, dev only. Optional args: [org-slug] [user-email].
bun run worker               # the standalone background worker (see Production)
bun test                     # the test suite (PGLite, no DATABASE_URL needed)
```

Linting and formatting are repo-wide and run from the root. **Biome is gone** — `oxlint` lints and `oxfmt` formats:
```bash
bun run check                # oxfmt --check + oxlint — what CI runs
bun run typecheck            # turbo: tsc --noEmit in both workspaces — also what CI runs
bun run lint                 # oxlint only
bun run format               # oxfmt --write
```

Two root configs cover **both** workspaces, and each workspace's own `lint`/`check` scripts point back at them (`--config ../../oxlint.config.ts`) so the same commands work from inside either package. Both are root devDependencies — don't add a second copy to a workspace, since two versions format differently and the drift is invisible until CI disagrees with your editor.

- **`.oxfmtrc.json`** — formatting. Migrated from the old biome config with `oxfmt --migrate=biome`, so the house style is unchanged: tabs, double quotes, width 80. `sortImports` replaces biome's `organizeImports`, and oxfmt also formats JSON and CSS, which biome's `files.includes` allowlist had left alone.
- **`oxlint.config.ts`** — linting. Three layers:
  1. `plugins` + `categories.correctness` — the parity layer, standing in for what biome's `recommended` used to catch (react, react-hooks, jsx-a11y, typescript, import, oxc).
  2. **anti-slop** ([dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)), vendored at `tools/oxlint/anti-slop/` and registered as a `jsPlugins` entry. Fifteen rules that reject low-evidence TypeScript: `unknown` in a contract, a `Record<string, unknown>` value type, a hand-rolled `typeof` narrowing where a parse belongs, a type assertion with no stated invariant. **Every one is an `error` and the tree is clean of them.**
  3. A handful of named rules that are neither — see the comments in the file.

**anti-slop is vendored, not depended on — those files are ours to edit**, and four of them carry a `Local amendment to the upstream rule` comment saying why: Zod's `.shape` is not a symbol this repo names; a `.catch()` handler's parameter is `unknown` because TypeScript makes it so; leading comments on an `export const` attach to the ExportNamedDeclaration, so the SAFETY lookup has to see through it. Read the comment before "fixing" one of these back.

**`SAFETY:` comments are load-bearing.** `require-safety-comment-for-type-assertion` fails the build on any non-`as const` assertion without one, so every remaining `as` in the tree states the invariant that makes it sound. A new assertion needs a real reason, not a restatement of the cast. Placement is fussy: the comment must be the line directly above the assertion **or** its containing statement, `//` not `{/* */}` (JSX comments are nodes, not comments), and a multi-line explanation must put the directive line last.

Tests have two helpers for the case that used to reach for an assertion — `at(rows, i)` and `present(value, what)` in `src/test/harness.ts`. Both fail the test naming what was missing, rather than turning a bad fixture into a null-dereference twenty lines later.

**55 warnings are expected and do not fail the build.** Fourteen are `typescript/no-non-null-assertion` (`process.env.X!` in the auth and drizzle configs, plus array-index assertions in two test files). The other 41 are pre-existing React and a11y findings that biome's ruleset never reported — `react/set-state-in-effect` (17), `jsx-a11y/no-autofocus` (9), `jsx-a11y/control-has-associated-label` (9), and a few others. They are real and deliberately left visible rather than switched off; promote each to `"error"` in `oxlint.config.ts` as it is burned down.

**One thing was lost in the move and is worth knowing:** nothing lints CSS any more. oxlint is JS/TS only and oxfmt only formats. `landing.css` carries a comment recording the two rules that used to be turned off for it and why both are right there.

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
- `src/test/harness.ts` — `createTestDb()` gives each test file an empty, freshly migrated **PGLite** (real Postgres, in-process WASM) and points the `db` proxy at it for the file's duration. Service tests need no DATABASE_URL, no container and no cleanup. `src/db/index.ts` resolves its handle lazily for this reason. **One engine is shared for the whole run and re-schema'd per file**, because a `WebAssembly.Memory` never shrinks: per-file instances made the suite's footprint the sum of every database it had ever opened (~11GB across thirty files), which a laptop absorbs and a 7GB CI runner answers with SIGKILL. `bunfig.toml` preloads `src/test/preload.ts` to close that engine once at the end — a live handle at exit is exit code 99 and a red CI for a suite where nothing failed.

`apps/web` layout:
- `src/routes/` — TanStack Router file-based routing. `$orgSlug/route.tsx` is the org-scoped layout: its `beforeLoad` resolves the session, the organization and the caller's role in ONE server call (`enterOrganization`) alongside `getPublicAppConfig`, and redirects out if any check fails — every nested route inherits that guard. It was four sequential server-function round trips, one of them a session write that ran on every navigation; `enterOrganization` only repoints the session when the active org actually differs. Under it: `time/` (index/`week`/`month`), `projects/`, `reports.tsx`, `close.tsx`, and `settings/` (organization, members, my-schedule, clients, tasks, recurring-blocks, holidays, hour-fund, integrations, preferences). `login.tsx` is the sign-in entry point (a redirect into Google, except in development and on OAuth errors); `accept-invite/$invitationId.tsx` handles invitations; `no-access.tsx` breaks a redirect loop. `api/auth/$.ts` mounts better-auth; `api/login.ts` starts the Google flow; `api/github/setup.ts` and `api/slack/callback.ts` are OAuth redirect targets; `api/reports/pdf.ts` renders the PDF; `api/v1/*` are public REST read endpoints reusing the same services via `resolveApiOrgContext(request)`, which lives in `server/api-auth.ts` — deliberately NOT in `server/auth.ts`, see the client-bundle rule below. `reports.tsx` is the shell only; its eight tab bodies live in `components/reports/`.
- `src/server/` — thin `createServerFn` wrappers, one file per aggregate, mirroring `services/`. **Auth is attached via middleware** (`sessionMiddleware` / `orgMiddleware` / `orgAdminMiddleware` from `server/auth.ts`), read from the handler's `context` arg — not by calling `requireOrgContext()` inline. That makes the protection part of the function's declared shape rather than an easy-to-forget first line. Every file in `server/` uses them; `auth.ts` itself is the only place the bare helpers are called, because route `beforeLoad`s need them. `orgMiddleware` also re-checks membership against the database (see Authorization), and does so inside its `.server()` callback rather than in a shared helper — a top-level function body in `auth.ts` ships to the browser, so a deferred `import("@farmer/core/services")` there becomes a real client chunk of the services barrel, which now fails the build outright when it reaches the native typst binding.
- `src/queries/` — TanStack Query `queryOptions` factories, one per aggregate; routes prefetch via loaders, components read via `useSuspenseQuery`. `queries/keys.ts` holds the root of every key family, and **every key names its organization**: `queryKeys(orgSlug).timeEntries`, so factories take the slug as their first argument (`timeEntriesRangeQuery(orgSlug, from, to)`) and components get it from `useOrgSlug()`, loaders from `params.orgSlug`. Factories spread their root and invalidations name the same one, so a write and the query it stales cannot drift. Never write a bare `queryKey: ["…"]` literal on either side, and never drop the org — an org-blind key is an answer from the previous workspace, which is what the layout route used to carry twenty lines of QueryClient-stamping and staged cache-purging to compensate for. Server functions are deliberately NOT generated from a shared declaration — see `docs/adr/0001-no-server-function-generator.md`.
- `src/components/ui/` — shadcn on **Base UI** (`@base-ui/react`), not Radix (`components.json` style is `base-nova`). Composition uses the `render` prop, not `asChild`.
- **Light/dark is `data-theme` on `<html>` and nothing else.** Both palettes are written out in full in `styles.css`; `lib/theme.ts` owns the attribute, and the DOM is the state — there is no provider and no second copy, because `themeInitScript` runs inline in `<head>` (see `__root.tsx`) long before React exists. It has to: the choice lives in localStorage, so the server cannot render it, and applying it on hydrate flashes the light palette on every cold load. That mismatch is why `<html>` carries `suppressHydrationWarning`. No stored choice follows the OS; one click outranks it from then on. The landing page states its own colours and pins itself light (`landing.css`), and the calendar's category tints (`lib/category-colors.ts`) are still light washes computed in JS — they stay legible in dark mode but read bright.

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

**Google is the only identity in production, and there is no login page there.** `emailAndPassword` is off, so there is no form to render and nothing to choose — "log in" is a redirect.

- **`routes/api/login.ts` is the sign-in surface.** A server route: it asks better-auth for the Google authorize URL and re-shapes that 200-plus-`Location` response into a real 302, copying the OAuth state/PKCE cookie across. Server-side rather than a client `authClient.signIn.social()` call so an unauthenticated document request reaches Google without the app hydrating at all.
- **`routes/login.tsx` stays a *page* route on purpose**, even though it renders almost never. Every `redirect({ to: "/login" })` and sign-out points at it, and a page route's `beforeLoad` runs both server-side and in the browser; `redirect({ href, reloadDocument: true })` turns either into the full-page hop `/api/login` needs.
- **Two cases render instead of redirecting.** `?error=…` — better-auth's `errorCallbackURL`, most usefully the single-org invite-only gate; that branch must not redirect, or an uninvited visitor bounces between `/login` and Google forever. And development, below.
- **`lib/dev-auth.ts` turns email + password back on off-production.** The gate is `NODE_ENV !== "production"` and deliberately **not** an opt-in env var: an opt-in flag is the kind of thing that gets copied from a `.env` onto a server, and this is the one feature where that mistake is a second way into the product. Both the Dockerfile and `apps/web`'s `start` script pin `NODE_ENV=production`, so every supported way of serving this app has it off; a fourth way of hosting it must set the variable too. Downstream nothing is special-cased — the same `databaseHooks.user.create` hooks bootstrap the org and seed its tasks, and single-org mode's invite gate still applies to a password signup. The client learns it from `getPublicAppConfig().devAuth`, which is also what hides Preferences → Sign-in methods in production: with no endpoint that can set a password and no way to unlink your only identity, both rows were permanently disabled.
- **`/` never redirects, in any mode.** Single-org mode used to bounce every visitor to their workspace and, signed out, on through `/login` to Google — so a deployment had no reachable front door at all: no address that answered with a page, and nowhere a sign-in screen offering anything but Google could live. The homepage now renders for everyone and its CTA resolves the destination (workspace / `/no-access` / `/login`).
- **`prompt: "select_account"` on the google provider is deliberate.** With no login screen there is nowhere to offer "use a different account".
- `session.freshAge: 0` — better-auth 403s `SESSION_NOT_FRESH` on unlink-account once a session is older than a day, and this app has no step-up re-auth flow, so integration disconnects would break.
- Invite context rides through as query params and is rebuilt into the Google `callbackURL`. `redirect` is attacker-supplied in principle, so `api/login.ts` accepts only a same-site absolute path (`/…` but not `//…`).

### Integrations (GitHub + Google Calendar + Slack)

GitHub and Google Calendar are per-member and opt-in via `integrationSettings` (a missing row = every toggle off, so connecting an account never silently enables background sync); Slack is per-org and admin-only. All three live on `$orgSlug/settings/integrations`, which renders admin-only sections behind `role`.

- **GitHub uses two distinct credential types, don't conflate them.** The per-user OAuth account link (`socialProviders.github`) is used **only for identity** — it touches exactly two endpoints, `GET /user` (resolve the login, to filter commits by author) and `GET /user/installations` (enumerate installations the person may connect). All actual repo/commit reads go through a **per-org GitHub App installation token** (`orgGithubInstallation`), obtained after an admin installs the App and GitHub redirects to `api/github/setup.ts`, which re-verifies admin role and resolves the org from a signed `state` (`lib/oauth-state.ts`). Env: `GITHUB_CLIENT_ID/SECRET` (OAuth) are separate from `GITHUB_APP_ID/SLUG/PRIVATE_KEY` (the App; private key is base64-encoded PEM).
- **The `repo` scope on that OAuth app looks removable and is not.** It is a broad grant (read *and* write on every private repo the person can reach) that reads no repo content in this app, so it reads like a leftover — but GitHub documents `GET /user/installations` as working only for OAuth/classic tokens carrying `repo`, and that call is the authorization gate in `connectInstallation` (you may only attach an installation you actually administer). Removing it breaks GitHub App connection for anyone who links their account afterwards. The real fix, if the grant is ever judged too broad, is to issue a GitHub App *user access token* instead of using a classic OAuth app — a provider change, not a scope edit. The comment at the call site says all this; read it before touching the line.
- **Google Calendar** is a per-user grant scoped to `calendar.events`, and lives on a **separate `genericOAuth` provider (`"google-calendar"`)** rather than on the login provider — so signing in never demands calendar access, and a plain login row can't be mistaken for a live calendar connection. It needs `accessType: offline` + `prompt: consent` to get a refresh token, or reads break after the ~1h access token expires. `syncedMeetingTombstone` records meetings the user deleted post-sync; `commitFillTombstone` is the same idea per *day* for the commit engine's rest-of-day block, which previously had nothing but the one-fill-per-day index — an index the deletion itself cleared, so the block came straight back. Creating a fill block deliberately clears the tombstone, since that is a change of mind.
- **Slack** is one workspace per org (`slackInstallation`), installed by an admin through Slack's OAuth v2 flow. The bot token is written straight to the database — no client, form or validator ever handles it, and no server function returns it. The redirect URI is derived once in `slackRedirectUri()` because Slack byte-compares it across the two legs. Membership hooks (`afterAcceptInvitation`, `afterAddMember`) auto-match new people to Slack; `linkMember` swallows its own errors, so a Slack outage costs the match, not the membership. Env: `SLACK_CLIENT_ID/SECRET`.

### The assistant

An OpenRouter-backed chat page (`$orgSlug/assistant`) that answers questions about tracked time and can log more of it. `services/assistant.service.ts` is the agent loop; `services/assistant-tools.ts` is what it may do.

- **Every tool is an adapter onto an existing service, called with the CALLER'S own `Ctx`.** That is the whole authorization story and it is deliberately not restated per tool: a Member's `list_time_entries` returns their own rows because `listRange` filters on `ctx.userId`, and their `create_project` is refused because `canCreateProjects` says so. Tool parameters are the *existing* Zod inputs from `src/schema/*` via `z.toJSONSchema()`, so the model inherits the same ceilings the UI has — hand-writing a JSON Schema per tool is how `api/v1/time-entries` lost the 62-day cap.
- **Three tool tiers, and the line is "can they undo this by asking for the opposite".** `read` answers; `write` (logging and correcting time, booking absence, reconciling a close row, creating clients/projects/tasks) runs inline; `destructive` (deleting an entry, archiving anything, finalizing or re-opening a month) suspends for approval. Asking before every write turned "reconstruct my week from my commits" into fifteen dialogs, which is the interaction the feature exists to replace. The two close transitions look like one decision and are two: `close_submit` is a write because a PM may re-submit freely, while `close_finalize` is destructive despite deleting nothing — it freezes the snapshots the variance report and the invoice are read off, and re-opening deliberately leaves them in place.
- **`toolDefinitions(access)` is scoped to the caller, and that is not the authorization.** The service behind each tool re-resolves `Access` and asserts; `AssistantTool.available` only decides what the model is *told* it can do. Every definition is re-sent on every step of every turn, so offering a Member the close sheet and the admin reports is a standing token cost plus a step spent being refused. Predicates stay coarse ("is a PM anywhere", never "on THIS project") because the arguments don't exist when the list is built — narrowing them would be the second copy of the §4 matrix.
- **A tool's arguments must be producible by some read, or it is uncallable.** `file_time_entries` takes entry ids and, for months, nothing returned any: `unfiled_summary` only counted them and `list_time_entries` reported a null project for absence too. Hence `list_unfiled_entries`; hence `list_commits` returning `projectGithubRepoId` + `sha` for `attach_commits`, and `list_tasks` including the absence tasks `listSelectable` excludes by design, which is what `log_absence` needs.
- **`assistantSettings.systemPrompt` is house rules an admin appends**, fenced in `<house-rules>` and explicitly ranked below the built-in prompt. Not a security boundary — an admin already holds the key — but a precedence one: the base prompt encodes domain facts (quarter-hour granularity, ids are looked up not invented) that stay true whatever conventions an org layers on.
- **Destructive tools suspend the loop for approval, and the pending state lives on the message row** (`assistantMessage.pendingApproval` + `approvalSummary`), not on the open SSE connection. Approving is a *second* `run` call that resolves it, so a tab closed mid-approval leaves a card that still works on reload. `approvalSummary` is stored rather than recomputed because it comes from `assistant-tools.ts`, which imports the services barrel and so can never reach the browser — and because it is the wording the person actually consented to. `summarize` takes the Ctx and may look its argument up, since "Archive project 3f2a9b1c…" is no more consentable than "archive a project"; it is best-effort and falls back rather than throwing, because a card that failed to render leaves a pending write nobody can answer either way.
- **A batch write suspends once and is approved row by row.** A tool that supplies `preview` (today `apply_day_assembly` and `file_time_entries`) stops the turn like a destructive one, and its card is a table of what it would touch; `withSelection` rebuilds the arguments from the ticked rows, so "yes to four of these five" has a spelling that approve/reject alone does not. This is not the fifteen dialogs the `write` tier avoids — fifteen rows in one card is one decision. The rows are stored on the message (`approvalPreview`, including whether they were tickable) for the same reason `approvalSummary` is: they cannot be rebuilt in the browser, and re-reading them after the write would show today's data rather than what somebody consented to. Approving with an empty selection is a refusal, not a write of nothing.
- **A rejected tool call still writes a `tool` message.** An assistant turn carrying `tool_calls` must be followed by one result per call id or the next request 400s, so "no" has to be an answer rather than a silence.
- **`components/assistant/answer.tsx` is the hand-rolled reader, and the prompt's formatting rules are its mirror.** Paragraphs, `#`–`###` headings, bullet and numbered lists, bold/italic/inline code, links, `---`, fenced code, and GFM pipe tables with column alignment. Beyond markdown it understands three directives, all of which the model is told about verbatim in `systemPrompt`: `[[YYYY-MM-DD]]` renders as a link to that day's timesheet (the cheap half of citations — the expensive half is every figure carrying its entry ids, which is a change to what every report returns), and fences tagged `farmer-chart` (a fixed two-form chart, `answer-chart.tsx`) and `farmer-next` (follow-up chips). A construct promised in the prompt and missing here renders as its own syntax, so the two files change together. Everything re-parses on every streamed delta, so half-arrived input must degrade rather than throw — a malformed chart falls back to a visible code block instead of taking its numbers with it.
- **`bun run db:seed-assistant-ui` (packages/core) seeds a "UI kitchen sink" thread** holding every construct above plus a live suspended approval, so the renderer can be looked at without spending a model call on it. Idempotent by title; dev only.
- **The turn streams over a server ROUTE** (`routes/api/assistant/stream.ts`), not a `createServerFn` — a server function resolves to one value. It authenticates through `server/api-auth.ts`, not `server/auth.ts`, for the client-bundle reason described above.
- **`lib/openrouter-client.ts` passes its own timeout.** `externalFetch`'s 15s default is an `AbortSignal.timeout` on the whole request, and a streamed answer is not complete until the last token — at 15s it doesn't fail to connect, it guillotines a working answer mid-sentence.
- **Three switches, all different.** `ASSISTANT_ENABLED=false` (env, default on) is the operator taking the feature off this deployment: no nav row, no route, a 404 from the stream endpoint, and every service path refused — except `settings.disconnect`, deliberately, so a key stays removable after the feature is switched off. `assistantSettings.enabled` is an admin pausing it for one org. A missing `assistantSettings` row is "never connected". A plain env var rather than `VITE_` for the same reason as `SINGLE_ORG_SLUG`; the client learns it from `getPublicAppConfig`.
- **The nav reads all three, not just the env one.** `$orgSlug/route.tsx` resolves `assistantAvailable` (deployment flag AND connected AND not paused) and hands it to both navs, so a paused or never-connected org has no Browse/Chat tabs in the sidebar and no Assistant row on mobile. Gating only on the env var left a Chat tab whose destination was a page explaining that the assistant isn't connected. The layout's loader warms `assistantSettingsQuery` so the tabs are settled on first paint rather than appearing and then vanishing; the ROUTE still renders its "ask an admin to connect this" screen, because someone who typed the URL deserves the explanation.
- **Model choice is admin-only.** There is no picker in the chat and `createConversationInput` carries no `model` — a conversation pins `assistantSettings.defaultModel` as it stood when it started, so changing the default never re-answers an old thread.
- The OpenRouter key is per-org, admin-set, and follows the Slack bot token's rule — written straight to the database, never returned. `settings.get` answers with a leading-characters-only hint (`sk-or-v1-abc123••••••••`); deliberately not the card-style last four, since the tail is the unguessable part.

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

`bun test` from `packages/core` (or `bun run test` from the root). Runs against PGLite via `src/test/harness.ts` — real Postgres, real migrations, a fresh database per file on one shared engine (see the note in the layout section above; it is what keeps the run inside CI's memory). No DATABASE_URL, no container, no cleanup.

Two things the harness does *not* do, which fixtures must account for: it runs the migrations but **not** `db/seed-tasks.ts`, so Vacation/Sick Leave don't exist unless you insert them; and migration `0024` already seeds the site-scoped **Meeting** and **Break** tasks, so inserting those again violates `task_site_name_uidx` — look them up by `systemKey` instead.

Coverage is uneven, and worth knowing before you trust a green run.

Covered: `access`, `close`, `ledger`, `notify`, `org-settings`, `day-assembly`, `holidays`, `projects` (list scoping, money and stats redaction), `recurring-block-rules` (including its assignment gate), `guards` (tenancy), and `time-entries` across six files (`absence-range`, `automation-since`, `commit-attach`, `copy-day`, `meeting-sync`, `time-entries.copy`), plus the automation sweep, the range ceilings in `src/schema/`, and the pure `lib/` arithmetic.

Also covered, and worth knowing what each file is *for* — these are the four services that turn close data into a number somebody invoices or acts on, so they are pinned on properties rather than on outputs: `reports` (utilization prefers the frozen `expectedAtFinalizeSeconds` over any later fund edit; each trend point equals the single-month roll-up; variance reads the finalize snapshot, not a live recompute; the detail's total stays whole when its rows hit the cap; Team Lead scoping on every tab), `compliance` (absence lowers the target and is *not* credited as work — the double-count that hid people from the pace check), `hour-fund` (null is not zero; `prefillYear` never clobbers a hand-entered figure and survives a concurrent write), `not-on-invoice` (strictly zero Final, finalized months only, internal hours don't count).

`compliance.service` takes an optional `{ now }` so the two views can be pinned to a date — every figure in them is a fraction of the month elapsed, and on the 1st `behindPace` is correctly empty. Same seam as `runAutomationsForUser`.

**Not covered at all:** `members`, `tasks`, `github`, `slack`, `google-calendar`, `working-hours`, `organization`, `account`, `notifications`, `clients`, `integration-settings`, `report-pdf`. Changing any of those means the suite cannot tell you whether you broke them.

Two PGLite limits the fixtures have already hit: a single multi-row insert of a few thousand rows overruns its bind-parameter handling and kills the instance for the rest of the FILE (chunk at ~500), and site-scoped tasks are unique on both name and `systemKey`, so seed Vacation once in `beforeAll` rather than per test.

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
