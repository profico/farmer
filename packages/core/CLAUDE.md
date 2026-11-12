# packages/core

`@farmer/core` — the business logic, the database and the jobs. Read the root
`CLAUDE.md` first for the commands, the lint rules and the boundary rule.

## Layout

`src/db/` (the schema), `src/services/` (one file per aggregate), `src/schema/` (Zod inputs), `src/api/`, `src/lib/` and `src/jobs/`. The notes that a file list cannot show:

- `src/db/index.ts` resolves the `drizzle-orm/postgres-js` client lazily — see Testing.
- `schema/auth.ts` is better-auth-owned and CLI-generated (`auth:generate`). It also holds the plugin tables: `oauthApplication`/`oauthAccessToken`/`oauthConsent` for MCP, the device codes for the CLI. `invitationEmail` sits in `schema/people.ts` because `invitation` is CLI-generated.
- **Tables with no `organization_id`, on purpose:** `pushSubscription`, `runningTimer` (`schema/timer.ts`, **unique on the PERSON, not on the workspace**, and the header says why) and `mobileDevice` (`schema/mobile.ts`, see `docs/domains/mobile.md`). `instanceSetting` (one row per setting, keyed by its environment variable name; a secret is sealed) and `instanceOAuthProvider` (`schema/instance.ts`) belong to the deployment. `apiToken` is keyed on the PERSON like a session, and `organization_id` is set only for a token bound to one workspace (`docs/domains/api-tokens.md`). `auditEvent` is append-only: a trigger refuses an UPDATE, and it has no foreign key to `user`, so names are snapshots (`docs/domains/audit-log.md`).
- `timeEntryGithubPrActivity` holds one row per pull request EVENT (opened, merged, closed, reviewed), not per PR. `webhookDelivery` holds one row per ATTEMPT and is the queue at the same time. A synced meeting carries `syncedDate/syncedDurationSeconds/syncedDescription`, what the calendar last said; the meeting engine is a per-field merge against them (`docs/domains/automation.md`).
- **Services without a `Ctx`:** `platform-admins` and `instance-settings` (instance-level, not tenanted), and `apiTokensService.authenticate`, like the session lookup it sits beside. `mobile-devices` takes a `PersonCtx`, because a phone belongs to a person. `org-context` is the slug-to-Ctx membership check that MCP and the CLI share. `member-joined.ts` is the Slack match and `member.added` that every way of joining runs. `pr-reviews.ts` holds the review-block rules that the commit engine and the day assembler share.
- Shared with other code: `lib/search.ts` is the list filter of the web app and the CLI. `lib/report-period.ts` and `lib/report-format.ts` are report arithmetic that the browser also needs. `lib/task-taxonomy.ts` (task groups, the standard org tasks, Harvest name aliases) is shared by the seed and the import.
- `src/schema/` is shared by the RHF form resolver, the server function `.validator()`, the REST handlers (`api/v1` and the CLI's API) and the assistant/MCP tool parameters. Range inputs carry their own ceilings (62 days for a time-entry range, 366 for a report), so a caller cannot ask for a full-table scan by widening the dates. **Don't re-validate by hand at a new call site** — that is how a caller ends up bypassing the ceiling.
- `src/api/` is exported as `@farmer/core/api`: the REST API's response shapes and their projection functions, plus `MIN_CLI_VERSION` and the CLI's error codes. Types-only imports, because the CLI binary imports it at runtime. The published mobile app parses these shapes: a new required field fails the parse in an old app, so deploy the server before a `mobile-v*` tag that needs it (`apps/mobile/CLAUDE.md`).
- `lib/time.ts` is **the only place timezone math should happen** (UTC in, display zone out, on `date-fns`/`@date-fns/tz`). `lib/uploads.ts` is browser-safe and `lib/storage.ts` server-only. `lib/harvest/` and `lib/github-activity.ts` are pure; `lib/harvest/` runs in a browser Web Worker. `lib/secret-box.ts` encrypts the Slack bot token, the OpenRouter key and the instance settings at rest, rotated through `BETTER_AUTH_SECRETS` (`docs/domains/integrations.md`, `docs/domains/deployment.md`).
- `src/jobs/` is exported as `@farmer/core/jobs`: `scheduler.ts` is the runner, `worker.ts` a standalone process entry, and each other file is one tick of work.

## Authorization

The full matrix is in `docs/domains/authorization.md`. Read it before you change who can see or do what. The rules:

- **`services/access.service.ts` is the only place that knows the matrix.** Three independent axes: one org role (Admin), a per-assignment project role, and a people list (the Team Lead).
- **Rank on a project is `heldAs`, not the raw row.** Role changes are capped at the caller's rank (`Access.canActOnProjectRole`).
- **Membership is a precondition, not a capability.** `accessService.resolve` throws `NotAMemberError` for a caller with no membership row, and for a pending Harvest import claim.
- Resolve `Access` **once per request** via `ctxAccess(ctx)` (`services/context.ts`). `scopeFor(role)` returns `null` for "unscoped", and an empty array means "nothing".
- `getMyAccess` (`server/auth.ts`) is **not** authorization. Every service re-resolves `Access` server-side and asserts.
- Anything that creates time entries needs both `assertTaskAvailable` (may this TASK go on the project) and `assertCanTrackOn` (may this PERSON write there).

## The ledger

`services/ledger.ts` is the one definition of what counts as logged time. What may vary between callers is the **projection** (columns, joins, grouping key). What must not vary is the **classification** and the tenancy/range predicate: `ledgerWhere` owns the predicate and `LedgerScope` the vocabulary — `worked`, `project`, `unfiled`, `absence`, `all`. A caller with a bespoke projection composes `ledgerWhere`; never hand-roll a `sum(durationSeconds) … groupBy` with its own predicate.

`LedgerFilter.visibleProjectIds` and `visibleUserIds` are ORed: a row passes if it is on a visible project OR belongs to a visible person. `null` means unscoped; both empty means nothing. `overtimeOnly` and `activeOnly` narrow further.

**A day holds at most 24 hours** (`MAX_DAY_SECONDS`, `lib/working-day.ts`). Every manual write that grows a day checks it and throws `DayCapacityError`: create, update, the week grid, copy day/week, day assembly and the PM absence writes. An edit that does not grow the day is allowed even on a day already over. The fill block and the meeting sync are exempt, since a fill block is sized from the remainder and a synced meeting mirrors the calendar. The recurring-block materializer is not: a rule is at most 24 hours, and a day with no room for its block gets none.

**Unfiled** = worked time with no project yet (a synced meeting, a commit fill block, an accepted assembly suggestion) — real work, not yet attributed, therefore a to-do. Absence is not unfiled (it never carries a project by definition), and neither is a project-less **Break** — nobody bills a client for lunch, so counting it would nag people to file something unfileable.

**A task can require a note** — `assertDescribed` (guards.ts) on `descriptionRequiredFor` (`lib/task-rules.ts`). Absence, Break, fill blocks and the week grid (`setWeekCell`) are exempt.

`timeEntriesService.listRange` writes on read by default: it recomputes (and drops) each day's fill block against the rows just read, bounded to the automation window. `listRange(ctx, range, { persist: false })` is the read-only variant, and `/home`, the MCP server and the assistant use it.

## Targets and Tracking

`compliance.service.ts` turns logged time into the numbers people act on. The target comes from the month's hour fund, prorated by working days. Read `docs/domains/compliance.md` before you change a target, a verdict or a day mark. The rules:

- **No hour fund means no verdict**, not "on track".
- The verdict counts only working days **before** today, so the day in progress never counts against anyone. The goal a person reads includes today (`targetThroughTodaySeconds`).
- A service that reads the date takes an optional `{ now }`, so a test can pin it.

## Tasks

One global list per org (`scope: "organization"`) plus **site-scoped built-ins** shared by every org: Vacation, Sick Leave and Paid Leave (absence), Meeting and Break. Every project offers every live task — there is deliberately no project scope and no per-project subset. Each task carries a `taskGroup` (`engineering`, `product`, `learning`, `general`, `time_off`); the standard org list, including Development and Code Review, is in `lib/task-taxonomy.ts`.

Engines resolve tasks by **`systemKey`**, never by name (`meeting`, `development`, `code_review`, `break`, `vacation`, `sick`, `paid_leave`). A name lookup switches an engine off silently when an org renames the task — no block, no error. Names stay freely editable.

`assertTaskAvailable` (guards.ts) lets any live non-absence task of the org, or any site task, go on any project. An absence task must carry no project; archived tasks and other orgs' tasks are refused.

**A person can switch tasks off** (Preferences → Your tasks, `hiddenTask`; `tasksService.hiddenIds` / `setHidden` / `showAll` / `hideAll`). It is per person per org and stored as what is hidden, so a task added later reaches everyone. It only narrows the web task picker, which filters itself: `listForProject`, `assertTaskAvailable`, reports, the API and the engines never read it, and a switched-off task can still be logged.

## Notifications

Read `docs/domains/notifications.md` before you change `notify.ts`, a reminder job or `reminder-recipients.ts`. The rules:

- **`notify(recipient, event)` (`services/notify.ts`) is the single way anything tells a person anything.** It never throws; it returns which channels delivered. `notificationsService.sendPush` is the push *transport* and is not a call site.
- **Who gets a reminder is decided in one place**, `services/reminder-recipients.ts`, which both jobs and the preview call.
- **Telling another SYSTEM something is `emitEvent`** (`services/events.ts`): one `webhook_event` row in the caller's transaction. `jobs/webhook-delivery.ts` does the sending (`docs/domains/webhooks.md`).
- **The Tracking rule is the reminders' rule** (`complianceService.trackingForReminderJob`). Nothing on `reminderSettings` decides who is behind.

## Members

**Never read the org roster through better-auth's `auth.api.listMembers`.** It throws in an organization over 100 people, which a Harvest import makes routine — archived people count towards the total. `membersService.roster` (`members.service.ts`) queries the tables directly and is what `server/members.ts`'s `listMembers` server fn calls; `auth/index.ts` also raises `membershipLimit` to 10,000 for the paths that still go through better-auth. Don't confuse either with `projectsService.listMembers`, which is a per-project assignment read.

**Keep better-auth's `bearer` plugin off** (`auth/index.ts`). With it, every server function would accept an `Authorization` header. See `apps/cli/CLAUDE.md` and `docs/domains/api-tokens.md`.

## Instance settings

**Read an instance-level value with `setting(name)` / `settingEnabled(name)` (`lib/instance-settings.ts`), never `process.env`.** Email, S3, the GitHub/Slack/Google credentials, VAPID, the push relay, PostHog, the three feature flags, `SINGLE_ORG_SLUG` and `CLI_RELEASES_REPO` are all in `INSTANCE_SETTINGS`. A non-empty environment variable wins and locks the page's field, else the `instance_setting` row, else the default (ADR 0004). A direct `process.env` read skips the stored half, and the page then shows a value the process does not use.

- **Reads are synchronous, from a snapshot** that `refreshInstanceSettings()` (`services/instance-settings.service.ts`) fills. The web middleware and each scheduler tick await it; a script must await it itself.
- **Read per call. Never capture a setting at module scope**, which is why `single-org.ts` exports `singleOrgSlug()` and no constant. Something BUILT from settings keeps the values it was built from and rebuilds when they differ: the SMTP transport (`email.ts`), the VAPID setup (`notifications.service.ts`), the GitHub App JWT (`github-client.ts`) and the web app's PostHog client.
- **`lib/instance-settings.ts` imports nothing**, so the flags and `storage.ts` stay importable without a database, and `lib/` never reaches into `services/` for a value.
- **Tests:** `setInstanceSettingsForTests(values)` replaces the stored half for a file, and `undefined` restores it. The environment still wins, and Bun loads the developer's `.env` into the suite, so a test that needs a name unlocked deletes the variable and puts it back after. The loaded snapshot is module state that outlives a file's database: a file that writes settings through the service clears it in `afterAll` (`replaceSettingsSnapshot(new Map())`).

## Ports and outbound calls

`services/ports.ts` — `calendarSource()`, `commitSource()` and `pullRequestSource()`, the substitutable seam the sync engines read through. The production adapter is the real service; tests install an in-memory one (`setCalendarSourceForTests`, `setCommitSourceForTests`, …).

**`lib/http.ts` (`externalFetch`) puts a deadline on every outbound call** (15s by default, `EXTERNAL_FETCH_TIMEOUT_MS`). `fetch` has no default timeout, and the sweep refuses a new tick while one is in flight, so one wedged socket would stop all syncing until a restart. `withTimeout` is the same idea one layer up.

**Never log a raw caught error.** Log `loggableError(error)` (`lib/loggable-error.ts`), or `loggableErrorLine(error)` for a string. A Drizzle error holds the query parameters in its message and its stack: a session token, an email, a relay id. The helper keeps the class, the code and the constraint, and drops the rest for a database error. Give PostHog `withoutQueryValues(error)` for the same reason.

## Testing

`bun test` from `packages/core` (or `bun run test` from the root). Test files sit beside the code as `*.test.ts`. `apps/cli` and `apps/web` have their own `bun test` suites. The web suite tests its `lib/` and `server/` helpers, and some `server/*.test.ts` files drive the real REST route handlers for the guards. Most routes and the pages have no test.

`createTestDb()` (`src/test/harness.ts`) gives each test file an empty, freshly migrated **PGLite** (real Postgres, in-process WASM) and points the `db` proxy at it for the file's duration — no DATABASE_URL, no container, no cleanup. `src/db/index.ts` resolves its handle lazily for this reason. **One engine is shared for the whole run and re-schema'd per file**, because a `WebAssembly.Memory` never shrinks: per-file engines made the suite's footprint the sum of every database it had opened (~11GB), which a 7GB CI runner answers with SIGKILL. `bunfig.toml` preloads `src/test/preload.ts` to close that engine at the end — a live handle at exit is exit code 99 and a red CI for a suite where nothing failed.

Fixture rules:
- The harness runs the migrations but **not** `db/seed-tasks.ts`, so Vacation and Sick Leave don't exist unless you insert them. Migrations already seed **Meeting** and **Break** (`0024`) and **Paid Leave** (`0038`); inserting those again violates `task_site_name_uidx` — look them up by `systemKey`.
- Site-scoped tasks are unique on both name and `systemKey`, so seed Vacation once in `beforeAll`, not per test.
- A single multi-row insert of a few thousand rows overruns PGLite's bind-parameter handling and kills the instance for the rest of the FILE. Chunk at ~500.
- A person needs an `account` row to receive a reminder (`docs/domains/notifications.md`).
- Pin the clock with `{ now }` where a service takes it (`compliance`, both reminder jobs, `runAutomationsForUser`) rather than depending on today's date.

The services that turn logged time into a number somebody acts on — `reports`, `compliance`, `hour-fund` — are pinned on properties rather than outputs: a detail's total stays whole when its rows hit the cap, Team Lead scoping holds on every tab, a null fund is not zero, `prefillYear` never clobbers a hand-entered figure.

**Not covered at all**, so the suite cannot tell you whether you broke them: the `google-calendar` **service** (its `lib/` client is tested; the engines read it through `test/calendar.ts`'s `fakeCalendar`); the `slack` service beyond `syncIdentities` and `sendInvitation`; the GitHub setup callback (`connectInstallation` behind it is covered in `github.test.ts`); `notificationsService.sendPush` beyond which subscriptions it keeps and drops (the test replaces `web-push`'s send). Member role changes have no service function; `services/audit-security.test.ts` drives better-auth's `updateMemberRole` for the audit row it writes, and nothing else about them is tested.

The subsystems with a long narrative are in the root `CLAUDE.md` table ("Where the rest lives"). Read the one you are about to change before you change it.
