# packages/core

`@farmer/core` — the business logic, the database and the jobs. This file covers
the whole package; read the root `CLAUDE.md` first for the commands and the
lint rules.

**Boundary rule:** `packages/core` never imports TanStack/React, because it must
stay runnable from another process. All business logic lives in `src/services/`,
one file per aggregate. Every exported service function takes an explicit
`ctx: { organizationId, userId }` (`src/services/types.ts`) as its first
argument — **tenancy is a parameter, never ambient**.

## Layout

`packages/core` layout:
- `src/db/` — `drizzle-orm/postgres-js` client (`index.ts`, resolved lazily — see Testing) + schema:
  - `schema/auth.ts` — better-auth-owned: user/session/account/verification/organization/member/invitation, plus the plugin tables (`oauthApplication`/`oauthAccessToken`/`oauthConsent` for MCP, the device codes for the CLI). CLI-generated, see `auth:generate`.
  - `schema/domain.ts` — client, project (`projectType`), task (`taskScope`, `taskGroup`, `systemKey`), projectMember, recurringBlockRule(+Skip), timeEntry (a synced meeting also carries `syncedDate/syncedDurationSeconds/syncedDescription`, what the calendar last said — the meeting engine is a per-field merge against them, see `docs/domains/automation.md`).
  - `schema/people.ts` — memberProfile, memberTypeHistory (effective-dated `memberType`), teamLeadPerson, invitationEmail (whether an invite email reached the provider; it sits here because `invitation` is CLI-generated).
  - `schema/schedule.ts` — memberWorkingHoursDay, disabledHoliday.
  - `schema/settings.ts` — integrationSettings, syncedMeetingTombstone, commitFillTombstone, pullRequestReviewTombstone, filingRule, hiddenTask (a person's switched-off tasks), orgSettings, reminderSettings, monthlyHourFund.
  - `schema/github.ts` — orgGithubInstallation, projectGithubRepo, timeEntryGithubCommit, timeEntryGithubPrActivity (one row per pull request EVENT — opened, merged, closed, reviewed — not per PR).
  - `schema/slack.ts` — slackInstallation, memberSlackIdentity, slackReminderLog.
  - `schema/notifications.ts` — pushSubscription, notificationSettings.
  - `schema/import.ts` — importRun, importMapping (what each Harvest import created, so undo removes exactly that).
  - `schema/assistant.ts` — assistantSettings, assistantConversation, assistantMessage.
  - `schema/webhooks.ts` — webhookEndpoint, webhookEvent (the outbox: one row per thing that happened), webhookDelivery (one row per ATTEMPT, and the queue at the same time).
  - `schema/instance.ts` — instanceSetting (one row per instance setting, keyed by its environment variable name; a secret is sealed) and instanceOAuthProvider. No organization column: they belong to the deployment.
  - `schema/timer.ts` — runningTimer (**unique on the PERSON, not on the workspace** — the one deliberate exception to the tenancy rule, and the header says why), timerSettings.
- `src/services/` — one file per aggregate: access, account, assistant, clients, compliance, day-assembly, filing-rules, github, google-calendar, harvest-import, holidays, hour-fund, instance-settings (the loader and the Infrastructure pages; no `Ctx`, like platform-admins), integration-settings, members, notifications, org-context (the slug-to-Ctx membership check MCP and the CLI share), org-settings, organization, platform-admins (the one service with no `Ctx` — it is instance-level, not tenanted), projects, recurring-block-rules, reminder-settings, reports, sessions (Preferences → Signed-in devices), slack, tasks, team-leads, time-entries, timers (the stopwatch — see `docs/domains/timer.md`), uploads, working-hours. Shared modules: `guards.ts`, `ledger.ts`, `unfiled.ts`, `notify.ts`, `events.ts` (the outbound sibling of `notify` — see Notifications below), `reminder-recipients.ts`, `context.ts`, `db-ctx.ts`, `ports.ts`, `day-fill.ts`, `pr-reviews.ts` (the review-block rules the commit engine and the day assembler share), `types.ts`, and the two tool registries `assistant-tools.ts` + `mcp-tools.ts`.
- `src/schema/` — Zod input schemas, one module per aggregate, shared by the RHF form resolver, the server function `.validator()`, the REST handlers (`api/v1` and the CLI's API) and the assistant/MCP tool parameters. Range inputs carry their own ceilings (62 days for a time-entry range, 366 for a report), so a caller cannot ask for a full-table scan by widening the dates. **Don't re-validate by hand at a new call site** — that is how a caller ends up bypassing the ceiling.
- `src/api/` — exported as `@farmer/core/api`: the REST API's response shapes and the projection functions that build them, plus `MIN_CLI_VERSION` and the CLI's error codes. Types-only imports, because the CLI binary imports it at runtime.
- `src/lib/` — `time.ts` (UTC-in/display-zone-out durations and timezones on `date-fns`/`@date-fns/tz`; **the only place timezone math should happen**), `working-day.ts`, `day-plan.ts`, `automation-window.ts`, `org-time.ts`, `org-country.ts`, `task-taxonomy.ts` (task groups, the standard org tasks and Harvest name aliases — shared by the seed and the import), `task-rules.ts`, `search.ts` (the list filter the web app and the CLI share), `report-period.ts` + `report-format.ts` (report arithmetic the browser also needs), the integration clients (`github-client.ts`, `google-calendar-client.ts`, `slack-client.ts`, `openrouter-client.ts`), `github-activity.ts` (pure: which day a pull request event belongs to, and whose it is), `http.ts`, `oauth-state.ts`, `secret-box.ts` (encryption at rest for the Slack bot token, the OpenRouter key and the instance settings, rotated through `BETTER_AUTH_SECRETS` — see `docs/domains/integrations.md` and `docs/domains/deployment.md`), `instance-settings.ts` (the registry and the synchronous `setting()` reader — see Instance settings below), `single-org.ts`, `dev-auth.ts`, the deployment flags `assistant-flag.ts` + `mcp-flag.ts` + `cli-flag.ts`, `uploads.ts` (browser-safe) + `storage.ts` (server-only), `slug.ts`, `email.ts`, `json.ts`. `harvest/` is the Harvest CSV parser and import planner — pure, because it runs in a browser Web Worker.
- `src/jobs/` — exported as `@farmer/core/jobs`. `scheduler.ts` is the runner, `worker.ts` a standalone process entry; `automation-sync.ts`, `log-reminders.ts`, `slack-reminders.ts`, `timer-sweep.ts`, `upload-sweep.ts` and `webhook-delivery.ts` are one tick of work each.
- `src/test/harness.ts` — see Testing.

## Authorization

**Three independent axes, and `services/access.service.ts` is the only place that knows the matrix.**

- **One org role:** Admin (better-auth's `member.role` = `owner` | `admin`, both mapping to the single Admin tier). There is deliberately no super-admin.
- **A per-assignment project role:** `member` | `team_lead` | `pm` on `projectMember`. The same person is PM on one project and a plain member on another, so a project role is never a property of the person. An inactive assignment (`active = false`) grants nothing.
- **A people list:** `team_lead_person` rows, edited by an Admin on the People page (`team-leads.service.ts`). Having people on your list is what makes you a Team Lead — there is no flag. A Team Lead sees everything about their people: their time on every project, Tracking, time off. `accessService.peopleScope` is the people-shaped scope (Tracking, Absence); `Access.canViewPerson` the per-person check.

**Rank on a project is `heldAs`, not the raw row.** `roleOn()` returns the assignment as stored — admins are not synthesised into a role, so a "your projects" filter still works — and `heldAs()` returns the effective role that screens and gates read. A Team Lead holds PM rank only on a project where their own assignment is `team_lead`; a `member` assignment never widens (`rankOf`), and `peopleScope` adds project rosters only from projects held at PM rank. **Role changes are capped at the caller's rank:** `Access.canActOnProjectRole(projectId, role, targetLeadsPeople)` lets a non-admin assign a role, or act on someone who holds it, only up to their own `heldAs` rank — and it ranks the target the same way, so `team_lead` counts as PM for somebody with a people list (`accessService.leadsPeople`), on an active row. `projectsService.assignMember`/`removeMember` enforce it. `apps/web/src/lib/project-access.ts` mirrors only the caller's half for the UI: it compares the raw role and knows nothing about the target's list, so the service is what refuses a list-holder. Managing project members and creating projects both need `team_lead` rank or above.

**A project can be open to the whole organization** (`project.openToOrg`, the switch on its Team page, PM or Admin). Every member may then track on it without an assignment — the org's Internal project, which a new hire should not wait to be added to. It grants Member rank and nothing else: `canTrackOn` and `scopeFor("member")` include it, while `roleOn`/`heldAs`/`assignments()` stay null for it, so a Member sees their own hours and no team, totals or money. Two assignment reads deliberately ignore it: `reposForUser` (GitHub commits are attribution, not access) and `projectIdsForUser` (a PM of an open project is not PM of everyone's absence).

**Membership is a precondition, not a capability.** `accessService.resolve` throws `NotAMemberError` when the caller has no membership row, rather than describing them as "nobody". A Ctx is built from `session.activeOrganizationId`, which is stamped when the workspace is entered and never revisited, so without this an ex-member's session still answered every org-wide read that filters only on `organizationId`. `orgMiddleware` and `resolveApiOrgContext` resolve `Access` at the boundary for the same reason, which also warms the request's memo.

`accessService.resolve(ctx)` returns an `Access` — four parallel queries (membership, assignments, lead list, open projects), then answered from memory. Resolve it **once per request** via `ctxAccess(ctx)` (`services/context.ts`), which memoizes it on the Ctx.

A Member sees strictly their own entries and gets every report scoped to themselves, so nobody is refused a report; on a project page a Member sees their own hours, never the project's totals or contributors. A PM adds project config and the two money fields on their projects. `scopeFor(role)` returns `null` for admins meaning "unscoped" — callers translate that into no project filter rather than a 200-id `IN` list, and an empty array is a real answer meaning "nothing".

`server/auth.ts`'s `getMyAccess` flattens this for the client to gate UI with. It is **not** authorization — every service re-resolves `Access` server-side and asserts.

Two gates that read as one and are not: `assertTaskAvailable` (guards.ts) asks whether a TASK may be used on a project; `assertCanTrackOn` asks whether this PERSON may write there. Anything that creates time entries needs both. `recurringBlockRulesService` runs both at create **and on every materializing pass** (plus project status and task archival), because a rule outlives the assignment, project and task that made it valid; a rule that no longer applies is skipped, not deleted.


## The ledger

`services/ledger.ts` is the one definition of what counts as logged time. What may vary between callers is the **projection** (columns, joins, grouping key). What must not vary is the **classification** and the tenancy/range predicate: `ledgerWhere` owns the predicate and `LedgerScope` the vocabulary — `worked`, `project`, `unfiled`, `absence`, `all`. A caller with a bespoke projection composes `ledgerWhere`; never hand-roll a `sum(durationSeconds) … groupBy` with its own predicate.

`LedgerFilter.visibleProjectIds` and `visibleUserIds` are ORed: a row passes if it is on a visible project OR belongs to a visible person. `null` means unscoped; both empty means nothing. `overtimeOnly` and `activeOnly` narrow further.

**A day holds at most 24 hours** (`MAX_DAY_SECONDS`, `lib/working-day.ts`). Every manual write that grows a day checks it and throws `DayCapacityError`: create, update, the week grid, copy day/week, day assembly and the PM absence writes. An edit that does not grow the day is allowed even on a day already over. The fill block and the meeting sync are exempt, since a fill block is sized from the remainder and a synced meeting mirrors the calendar. The recurring-block materializer is not: a rule is at most 24 hours, and a day with no room for its block gets none.

**Unfiled** = worked time with no project yet (a synced meeting, a commit fill block, an accepted assembly suggestion) — real work, not yet attributed, therefore a to-do. Absence is not unfiled (it never carries a project by definition), and neither is a project-less **Break** — nobody bills a client for lunch, so counting it would nag people to file something unfileable.

**A task can require a note** — `assertDescribed` (guards.ts) on `descriptionRequiredFor` (`lib/task-rules.ts`). Absence, Break, fill blocks and the week grid (`setWeekCell`) are exempt.


## Targets and Tracking

`compliance.service.ts` turns logged time into the numbers people act on — the home page, the timesheet's targets strip, the Tracking report and the reminders all read it.

- **The target comes from the month's hour fund** (`monthlyHourFund`), prorated by working days: weekdays minus public holidays, so a day is 8h. Expected (`hour-fund.service.ts`) is the fund minus absence days × 8. There is no per-member weekly target (migration `0051` dropped it); working hours (`memberWorkingHoursDay`) only shape fill blocks, time-off spans and when a reminder reaches someone.
- **Total = work + time off**, compared against the target *so far*. Working days elapsed are counted strictly **before** today (the whole month once it is over), and the verdict reads `totalSoFarSeconds` through today, so the day in progress never counts against anyone.
- **Person type decides who has a target** (`memberType`, effective-dated through `memberTypeHistory`): hourly students and contractors have none without an override; overhead employees and archived people are never listed.
- **No hour fund means no verdict**, not "on track": the nudge sends nothing, and the digest and preview say no fund is set (`reminder-recipients.ts`).
- `complianceService.myTargets` returns week and month `PeriodTarget`s for `components/targets.tsx`. The service takes an optional `{ now }` so a test can pin the date — every figure is a fraction of the period elapsed.
- **A short day is marked only while its week is behind** (`lib/day-marks.ts`, issue #58). The timesheet's week strip and the home page's week chart both read `weekDayMarks`: a working day is `done`, `short`, or `covered` — under a day's worth, but the rest of the week (weekends included) has made up for it, and a covered day shows no label. A past day is held to the week tile's own yardstick, so it is never red beside a tile that says on track; today also counts its own day's worth, or it would go quiet every morning for anyone exactly on target.


## Tasks

One global list per org (`scope: "organization"`) plus **site-scoped built-ins** shared by every org: Vacation, Sick Leave and Paid Leave (absence), Meeting and Break. Every project offers every live task — there is deliberately no project scope and no per-project subset. Each task carries a `taskGroup` (`engineering`, `product`, `learning`, `general`, `time_off`); the standard org list, including Development and Code Review, is in `lib/task-taxonomy.ts`.

Engines resolve tasks by **`systemKey`**, never by name (`meeting`, `development`, `code_review`, `break`, `vacation`, `sick`, `paid_leave`). A name lookup switches an engine off silently when an org renames the task — no block, no error. Names stay freely editable.

`assertTaskAvailable` (guards.ts) lets any live non-absence task of the org, or any site task, go on any project. An absence task must carry no project; archived tasks and other orgs' tasks are refused.

**A person can switch tasks off** (Preferences → Your tasks, `hiddenTask`; `tasksService.hiddenIds` / `setHidden` / `showAll`). It is per person per org and stored as what is hidden, so a task added later reaches everyone. It only narrows the web task picker, which filters itself: `listForProject`, `assertTaskAvailable`, reports, the API and the engines never read it, and a switched-off task can still be logged.


## Notifications

`services/notify.ts` — `notify(recipient, event)` is the single way anything tells a person anything. The recipient is always an `(organizationId, userId)` pair, so membership is checked on every channel; a `KINDS` table says which channels a kind uses and which `notificationSettings` column gates it. Adding a channel is one adapter plus one row in that table. Never throws — it returns which channels delivered. Substitutable via `setNotifyAdaptersForTests`. `notificationsService.sendPush` is the push *transport* and is not a call site: push subscriptions belong to a device, so nothing there can know which org is speaking.

**Reminders are configured per org on Settings → Reminders** (`reminderSettingsService`: `get`, `update`, `preview`; design in `docs/plans/reminder-settings.md`). A missing `reminderSettings` row is the defaults. Who gets a reminder is decided in one place, `services/reminder-recipients.ts`, which both jobs and the preview call — so the preview cannot disagree with what the job then sends.

- **`KINDS` rows carry a `reminder` flag, and `deliveryBlocks()` holds reminder kinds back** from, in order: non-members, archived people, people who have never signed in (no `account` row) and people who opted out. The never-signed-in gate is on by default; `reminderSettings.includeNeverSignedIn` turns it off. A test person therefore needs an `account` row unless the fixture sets that flag.
- **`timer-dropped` is the one kind that is not a reminder and has no preference column.** A timer the sweep dropped logged nothing, so the person has to hear about it; the read path (`timersService.get`, and every surface that calls it) is the promise and the push plus the Slack message are the courtesy. See `docs/domains/timer.md`.
- **Both jobs read org-level state once per org**, not once per member, and both take `{ now }`. The Slack job ticks every 15 minutes, skips a kind that already ran today or is not due before any heavy query, and checks the delivery gates before it claims `slackReminderLog` — so a blocked person does not burn the day's claim. An undelivered DM marks the claim row for a retry (`retry`, with the count in `attempts`, at most three a day, so a restart does not reset it), unless the channel answers `"unreachable"` (`ChannelResult` in `notify.ts`: no Slack match, or a code in `RECIPIENT_REFUSALS`, `lib/slack-client.ts`) — then the claim stays and nothing counts as failed. A refused bot token (`CREDENTIAL_REFUSALS`) is recorded on the installation by `slackService.rejectToken`, and the job ends the org's pass after that send. `forgetSlackReminderRunsForTests()` clears its in-memory record of the day's runs.
**Telling another SYSTEM something is `services/events.ts`**, the same shape one
step further out: `emitEvent(ctx, kind, build)` writes one `webhook_event` row in
the caller's transaction and returns, and `jobs/webhook-delivery.ts` does the
sending. `build` is a function rather than a payload because almost no org has an
endpoint and all of them write time entries — see `docs/domains/webhooks.md`,
which also says which writes deliberately emit nothing (every automation engine,
and the Harvest import).

- **The Tracking rule is the reminders' rule.** `complianceService.trackingForReminderJob` is what the nudge, the month-end "only behind" option and the digest read; a person is nudged when the rule calls them *behind* (see Targets and Tracking) by more than `orgSettings.trackingTolerancePct` (default 5). Nothing on `reminderSettings` decides who is behind, and the nudge never goes out on a weekend or a public holiday.


## Instance settings

**Read an instance-level value with `setting(name)` / `settingEnabled(name)` (`lib/instance-settings.ts`), never `process.env`.** Email, S3, the GitHub/Slack/Google credentials, VAPID, PostHog, the three feature flags, `SINGLE_ORG_SLUG` and `CLI_RELEASES_REPO` are all in `INSTANCE_SETTINGS`. A non-empty environment variable wins and locks the page's field, else the `instance_setting` row, else the default (ADR 0004). A direct `process.env` read skips the stored half, and the page then shows a value the process does not use.

- **Reads are synchronous, from a snapshot** that `refreshInstanceSettings()` (`services/instance-settings.service.ts`) fills. The web middleware and each scheduler tick await it; a script must await it itself.
- **Read per call. Never capture a setting at module scope**, which is why `single-org.ts` exports `singleOrgSlug()` and no constant. Something BUILT from settings keeps the values it was built from and rebuilds when they differ: the SMTP transport (`email.ts`), the VAPID setup (`notifications.service.ts`), the GitHub App JWT (`github-client.ts`) and the web app's PostHog client.
- **`lib/instance-settings.ts` imports nothing**, so the flags and `storage.ts` stay importable without a database, and `lib/` never reaches into `services/` for a value.
- **Tests:** `setInstanceSettingsForTests(values)` replaces the stored half for a file, and `undefined` restores it. The environment still wins, and Bun loads the developer's `.env` into the suite, so a test that needs a name unlocked deletes the variable and puts it back after. The loaded snapshot is module state that outlives a file's database: a file that writes settings through the service clears it in `afterAll` (`replaceSettingsSnapshot(new Map())`).


## Ports and outbound calls

`services/ports.ts` — `calendarSource()`, `commitSource()` and `pullRequestSource()`, the substitutable seam the sync engines read through. The production adapter is the real service; tests install an in-memory one (`setCalendarSourceForTests`, `setCommitSourceForTests`, …).

**`lib/http.ts` (`externalFetch`) puts a deadline on every outbound call** (15s by default, `EXTERNAL_FETCH_TIMEOUT_MS`). `fetch` has no default timeout, and the sweep refuses a new tick while one is in flight, so one wedged socket would stop all syncing until a restart. `withTimeout` is the same idea one layer up.


## Testing

`bun test` from `packages/core` (or `bun run test` from the root). Test files sit beside the code as `*.test.ts`. `apps/cli` has its own `bun test` (the duration and date parsers, the table format, the device flow and the API client against an injected `fetch`). `apps/web` has none, so `api-route.ts` and the routes are untested — which is why everything testable about the CLI's API (the membership check, the projections, the version compare, the flag) lives in `packages/core`.

`createTestDb()` (`src/test/harness.ts`) gives each test file an empty, freshly migrated **PGLite** (real Postgres, in-process WASM) and points the `db` proxy at it for the file's duration — no DATABASE_URL, no container, no cleanup. `src/db/index.ts` resolves its handle lazily for this reason. **One engine is shared for the whole run and re-schema'd per file**, because a `WebAssembly.Memory` never shrinks: per-file engines made the suite's footprint the sum of every database it had opened (~11GB), which a 7GB CI runner answers with SIGKILL. `bunfig.toml` preloads `src/test/preload.ts` to close that engine at the end — a live handle at exit is exit code 99 and a red CI for a suite where nothing failed.

Fixture rules:
- The harness runs the migrations but **not** `db/seed-tasks.ts`, so Vacation and Sick Leave don't exist unless you insert them. Migrations already seed **Meeting** and **Break** (`0024`) and **Paid Leave** (`0038`); inserting those again violates `task_site_name_uidx` — look them up by `systemKey`.
- Site-scoped tasks are unique on both name and `systemKey`, so seed Vacation once in `beforeAll`, not per test.
- A single multi-row insert of a few thousand rows overruns PGLite's bind-parameter handling and kills the instance for the rest of the FILE. Chunk at ~500.
- A person needs an `account` row to receive a reminder (see Notifications).
- Pin the clock with `{ now }` where a service takes it (`compliance`, both reminder jobs, `runAutomationsForUser`) rather than depending on today's date.

The services that turn logged time into a number somebody acts on — `reports`, `compliance`, `hour-fund` — are pinned on properties rather than outputs: a detail's total stays whole when its rows hit the cap, Team Lead scoping holds on every tab, a null fund is not zero, `prefillYear` never clobbers a hand-entered figure.

**Not covered at all**, so the suite cannot tell you whether you broke them: the `google-calendar` **service** (its `lib/` client is tested; the engines read it through `test/calendar.ts`'s `fakeCalendar`); the `slack` service beyond `syncIdentities` and `sendInvitation`; the GitHub installation flows (`connectInstallation` and the setup callback); `notificationsService.sendPush` beyond which subscriptions it keeps and drops (the test replaces `web-push`'s send); member role changes (better-auth's `updateMemberRole`, which has no service function); and everything in `apps/web`.


## The subsystems documented elsewhere

Each of these is a narrative too long to carry here. Read the one you are about
to change before you change it.

- `docs/domains/automation.md` — `jobs/automation-sync.ts`, the recurring-block,
  meeting and GitHub commit/PR engines, the window policy, the filing rules.
- `docs/domains/assistant.md` — `assistant.service.ts` and `assistant-tools.ts`.
- `docs/domains/mcp-server.md` — `mcp-tools.ts`, the same registry over HTTP.
- `docs/domains/integrations.md` — the GitHub, Google Calendar and Slack
  credentials and the services that hold them.
- `docs/domains/authentication.md` — better-auth, the login flow, single-org mode.
- `docs/domains/harvest-import.md` — `harvest-import.service.ts` and `lib/harvest/`.
- `docs/domains/uploads.md` — `lib/storage.ts`, `uploads.service.ts`, the sweep.
- `docs/domains/webhooks.md` — `services/events.ts`, `webhooks.service.ts`,
  `jobs/webhook-delivery.ts`, the signature and the SSRF guard.
- `docs/domains/timer.md` — `timers.service.ts`, `jobs/timer-sweep.ts`, the
  stopwatch's one row per person.
- `docs/domains/deployment.md` — the instance settings, the env flags and how
  the jobs are hosted.
