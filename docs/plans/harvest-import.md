# Plan: import Harvest exports

Status: draft, for review. Nothing is built yet.

An admin drops the Harvest export files on a Settings page. The app reads the
files, shows what it will create and what it will drop, and then imports the
data. This document records what the exports contain, what the schema can hold,
the rules that connect the two, and the open decisions.

## 1. What the exports contain

The files are from `~/Downloads/harvest` (exported on 2026-09-11).

| File | Rows | Use |
|---|---|---|
| `harvest_time_report.csv` | 239,912 | Yes. This is the history. |
| `harvest_people_list.csv` | 64 | Yes. The only source of emails. |
| `harvest_project_list.csv` | 59 | Yes. Active projects, codes, hour budgets. |
| `harvest_task_list.csv` | 99 | Yes. Active/inactive flag for tasks. |
| `harvest_client_list.csv` | 134 | Yes, names only. |
| `harvest_all_estimates_as_pdf.zip` | 1 | No. It holds one test estimate ("Testni Report", 42 USD). The schema has no money model. |

### The time report, measured

- 22 columns: `Date, Client, Project, Project Code, Task, Notes, Hours,
  Billable?, Invoiced?, Approved?, First Name, Last Name, Employee Id, Roles,
  Teams, Employee?, Billable Rate, Billable Amount, Cost Rate, Cost Amount,
  Currency, External Reference URL`.
- 630,211 hours, from 2014-12-30 to 2026-09-14. The last date is after today.
- Harvest is still in use: 2,798 rows in 2026-08 and 785 rows in 2026-09.
- **No Harvest ID and no email on a row.** A row names a person by first and
  last name only.
- 114 people. The people list has 64 of them (all 64 have time). **50 people
  exist only in the time report**, with no email. These are former employees,
  for example Ivan Lovrić (12,235 h, 2017 to 2024). No two people share a name.
- 270 projects. The project list has 59 of them (all 59 match). **211 projects
  exist only in the time report**. No project code is used twice.
- 127 clients and 92 tasks. Every task is in the task list.
- Numbers use a decimal comma and a thousands dot (`"10.773,68"`).
- 49,574 rows have empty notes. 28,022 notes have more than one line. The
  longest note has 2,000 characters.
- 30,190 cases of more than one row for the same person, day, project and task.
  This is normal and each row stays a row.

### Durations

- 225,643 rows (94%) are on the 15-minute grid. 14,269 rows are not (for
  example 20, 10 or 40 minutes).
- If each row is rounded to the nearest 15 minutes, with a minimum of 15
  minutes, the total changes by +98 hours (0.016%). If each row is rounded up,
  the total changes by +1,959 hours.
- 192 rows are shorter than 7.5 minutes. 3 rows are longer than 24 hours, and 2
  person-days have more than 24 hours. These are data errors.

### Billability

- 139 projects have only non-billable rows. 60 have only billable rows.
- 71 projects mix the two, with 78,623 non-billable hours. Of these,
  56,111 hours are on "Profico :: Internal", which becomes an `internal`
  project anyway. Approximately 22,500 non-billable hours on other projects
  lose the flag, because billability here comes from the project type.

### Absence

- Three Harvest projects hold absence: Vacation (`PVC`, 27,483 h), Sick Leave
  (`PSL`, 2,418 h) and Paid Leave (`PPL`, 2,199 h).
- The absence tasks also occur on normal projects: Vacation (2,278 h), Sick
  leave (280 h) and Paid leave (121 h), mostly on "Profico :: Internal".
- This app has Vacation and Sick Leave. It has no Paid Leave task (see decision
  D2).

### Overtime

Three tasks mean overtime: "Framer Overtime" (238 h), "Design Overtime" (123 h)
and "Development (Overtime)" (12 h). This app has an `overtime` flag on the entry
(see decision D3).

## 2. What comes across, and the rules

### Clients

- One client for each distinct client name in the time report and the client
  list. Match an existing client by name (case and spaces ignored).
- The Harvest clients "Profico" and "Internal" map to the org's internal client
  (`clientsService.ensureInternal`). The review screen can change this.
- A client with no active project is created archived.
- The address is dropped. Only one client has one.

### Projects

- One project for each distinct (client, project, code) in the time report.
- Status: `active` if the project is in the project list, else `archived`.
- Suggested type (the admin can change it for each project):
  - only non-billable rows: `internal`;
  - `Budget By = Hours`: `fixed_scope`, with `Budget` in `budgetSeconds`;
  - all others: `product_team` (the schema default).
- Code: the Harvest code, cut to 16 characters (`createProjectInput` limit).
- Dropped: notes, start and end dates, amounts, costs, expenses, invoiced
  amount, budget spent and remaining. The schema has no column for them.
- The absence projects (`PVC`, `PSL`, `PPL`) are not created. Their rows become
  absence entries.

### Tasks

- Match by name (case and spaces ignored), in this order:
  1. site tasks: "Meeting" to Meeting, "Break" and "Daily Break" to Break;
  2. absence: "Vacation" to Vacation, "Sick leave" to Sick Leave, "Paid leave"
     as D2 decides;
  3. existing org tasks, including "Development" (the `development` system key);
  4. else create an org task.
- A task with `Active? = No` is created archived.
- Overtime tasks follow D3.
- The billable rate and the billable flag are dropped.

### People

A person is keyed by email when the people list has one, else by full name.

- **An existing member with the same email:** match. Do not change the role, the
  name or the type. Only fill a profile field that is empty.
- **A person in the people list who is not a member:** create `user`, `member`,
  `memberProfile`, `memberTypeHistory` and `memberSchedule` rows.
  - `emailVerified = true`. This is necessary: better-auth links a Google
    sign-in to an existing user only when the local user is verified
    (`requireLocalEmailVerified` defaults to true, see
    `better-auth/dist/oauth2/link-account.mjs`). Without it, the first Google
    sign-in fails.
  - Role: `admin` if Harvest `Admin = Yes` (the Harvest Owner also becomes
    `admin`, because the org already has an owner), else `member`. Harvest
    "Manager" has no org-level match here, and the export has no project
    assignments, so no per-project PM role can be derived.
  - Type: `contractor` if `Employee? = No`, else `billable`. The admin sets
    `overhead` on the review screen. The type segment starts on the date of the
    first entry.
  - `startDate` = the date of the first entry.
  - `weeklyTargetSeconds` = `Capacity` x 3600 (one person has 25 h).
- **A person only in the time report (50 people):** create the same rows, but
  archived (`archivedAt` = the day after the last entry) and with a placeholder
  email (see D4). They cannot sign in.
- Dropped: rates, roles, teams, employee ID.

**Access warning for the review screen:** a created person with a real email
gets into the workspace at the first Google sign-in with that address. This is
the same as an invitation, but it does not expire. In single-org mode the
invitation gate does not apply to them, because the user row already exists.

### Project members and project tasks

The exports have no assignments. Derive them from the time report:

- `projectMember` for each (project, person) pair with at least one row. Role
  `member`. `active = true` only if the project is active, the person is
  active, and the pair has a row in the 90 days before the cutoff date.
- `projectTask` for each (project, task) pair, except absence tasks and the site
  tasks that are available on every project (`isUniversalTask`).

### Time entries

- `date` = `Date`. `description` = `Notes` (empty notes stay `""`).
- `durationSeconds`: round to the nearest 900 seconds, with a minimum of 900
  (see D6). The review screen shows the change for each person and month.
- Absence: when the task or the project is an absence one, the entry takes the
  absence task and `projectId = null`.
- `overtime`: see D3. Else `false`.
- `fillsDay = false`, `syncLocked = true`. A person already owns these rows, so
  no automation may rewrite them.
- Only rows with `date < cutoff` are imported (see D1).
- Dropped: `Billable?`, `Invoiced?` (all rows are "No"), `Approved?` (9,503 rows
  are "Yes"; the app has no approval concept), rates, amounts, currency, and
  `External Reference URL` (94 rows).

### After the entries

These are options on the last step, all on by default:

- Set `orgSettings.automationLockedThrough` to the day before the cutoff, if
  that is later than the current value. The calendar and commit engines then
  cannot write into imported days.
- Run `hourFundService.prefillYear` for each imported year. Without a monthly
  hour fund, Expected is null and utilization is empty for those months.
  `prefillYear` never overwrites a value that a person entered.
- Do not create `monthlyClose` rows. Past months read as Open, which is
  correct: nobody reconciled them in this app.

## 3. Identity of an imported row

The CSV has no Harvest ID, so the import makes one:

```
importKey = sha256(date, first, last, client, project, code, task, notes, hours)
            + ":" + n   // n = the position among identical rows, from 0
```

A second import of the same file gives the same keys, so it adds nothing. A row
that someone changed in Harvest after the first import gets a new key, so a
second import would add it again. For that reason a later import uses
"replace" mode for its date range (see D8).

## 4. Architecture

The design follows the boundary rule: all logic in `packages/core`, thin server
functions, and the UI in `apps/web`.

### `packages/core/src/lib/harvest/` (pure, no database, safe in the browser)

- `csv.ts`: an RFC 4180 parser that yields rows. It handles quotes, `""`,
  line breaks in quotes, CRLF and a BOM. It streams, so a 45 MB file does not
  hold two copies in memory.
- `number.ts`: reads `"10.773,68"` and `"10,773.68"`. It finds the decimal
  mark once per file from the header's numeric columns.
- `detect.ts`: identifies a file from its header (people, clients, projects,
  tasks, time, estimates, unknown).
- `plan.ts`: `planHarvestImport(files, snapshot, choices)` makes the full
  import plan: what to match, what to create, what to drop, and the counts for
  each. The review screen and the tests use it.

The browser runs the parser and `plan.ts` in a Web Worker, so the page stays
responsive while it reads 240,000 rows.

### Database (one migration)

- `import_run`: `id`, `organizationId`, `source` (`'harvest'`),
  `createdByUserId`, `cutoffDate`, `status` (`started` | `finished` |
  `undone`), counts, `createdAt`, `finishedAt`.
- `import_mapping`: `organizationId`, `runId`, `kind` (`client` | `project` |
  `task` | `person`), `sourceKey`, `localId`, `created` (true if this run
  created the row, false if it matched an existing one). Unique on
  (`organizationId`, `kind`, `sourceKey`), so a second run uses the same
  mappings.
- `time_entry.import_run_id` (nullable, FK to `import_run`) and
  `time_entry.import_key` (nullable), with a partial unique index on
  (`organization_id`, `import_key`) where `import_key is not null`.

Columns on `time_entry` cost nothing on hand-made rows. They also make undo one
`DELETE` for each run.

### `packages/core/src/schema/harvest-import.ts`

Zod inputs: the reference plan (clients, projects, tasks, people, pairs,
choices), an entry chunk (a maximum of 2,000 rows), and the finish options.

### `packages/core/src/services/harvest-import.service.ts`

Every function starts with `requireAdmin(ctx)`.

- `snapshot(ctx)`: the existing clients, projects, tasks and members (with
  emails), for the matching step.
- `overlap(ctx, cutoff)`: for each person, the days before the cutoff where the
  app already has entries. The review screen shows this.
- `start(ctx, plan)`: in one transaction, creates the run, the reference rows
  and the mappings. It checks every existing ID that the client sends against
  the org, and every email against `user.email` uniqueness.
- `importEntries(ctx, runId, chunk)`: inserts in batches of 500 with
  `onConflictDoNothing` on the import key. It checks every `userId`,
  `projectId` and `taskId` against the run's mappings (a `Set` in memory), so a
  chunk cannot write to another org or to a project outside the plan. It is
  safe to retry.
- `finish(ctx, runId, options)`: the lock watermark and the hour fund.
- `listRuns(ctx)` and `undo(ctx, runId)`: undo deletes the run's entries, then
  the rows that the run created (`created = true`), in reverse order. It refuses
  if a month in the range is submitted or finalized.

### `apps/web`

- `src/server/harvest-import.ts`: one server function for each service
  function, all with `orgAdminMiddleware`, each with the deferred
  `import("@farmer/core/services")`.
- `src/routes/$orgSlug/settings/import.tsx`: the page, admin only, with a row
  in `components/settings-nav.tsx`.
- `src/components/import/`: the drop zone, the review tabs, the progress view,
  and the Worker.

## 5. The screen

1. **Drop.** Drop one or more files. Each file shows its kind, its row count,
   and "used" or "not used, because ...". The estimates zip shows "not used:
   the app has no money data".
2. **Review.** Summary numbers at the top: people, projects, clients, tasks,
   entries, hours before and after rounding, hours dropped. Then tabs:
   - People: name, email (editable for the 50 former employees), match
     (existing, new active, new archived), role, type. The access warning from
     section 2 is on this tab.
   - Projects: client, name, code, hours, billable and non-billable hours,
     type, status, budget.
   - Clients and Tasks: match (internal, site, existing, new) and status.
   - Time: hours for each year, the cutoff date with the overlap count, rows
     that need attention (longer than 24 hours, after today), and the choices
     for D2, D3 and D6.
3. **Import.** A progress bar: reference data first, then entry chunks (about
   120 chunks of 2,000 rows). After an error, "Retry" continues from the failed
   chunk. If the tab closes, drop the file again: the import keys skip what
   already exists.
4. **Done.** Counts, and a list of runs with "Undo".

## 6. Tests (`packages/core`, PGLite)

- `lib/harvest`: the parser (quotes, lines in quotes, CRLF, BOM, empty last
  line), both number formats, file detection, the import key (stable, and the
  counter for identical rows).
- `plan.ts`: absence mapping (task on a normal project, project with an absence
  task), overtime, rounding and the minimum, project type rules, client and
  task matching, people from the time report only.
- Service: admin only; a second `importEntries` of the same chunk adds
  nothing; a chunk with an ID from another org fails; an existing member is not
  changed; a created user has `emailVerified = true`; undo removes only what the
  run created; undo refuses after a finalize.
- Update the coverage list in `CLAUDE.md`.

## 7. Phases

1. `lib/harvest` and its tests. Run it on the real files and compare the
   totals for each person and year with a Harvest report.
2. Migration, service and tests.
3. Server functions and the screen.
4. A dry run on a copy of the production database.
5. Cutover: choose the date, stop use of Harvest, run a last import in replace
   mode.

## 8. Open decisions

Each item has a recommendation.

- **D1. Cutoff date.** Harvest is still in use, and this app may already have
  entries for August and September. Rows on or after the cutoff are not
  imported. Recommendation: the day people started to log time in this app.
  The review screen shows the overlap before the import.
- **D2. Paid leave (2,320 h).** Option A: map it to Vacation. Expected hours
  stay correct, but the label is wrong. Option B: add a third site absence task
  "Paid Leave" (a new `task_system_key` value, a migration and the seed).
  Recommendation: B, because paid leave (for example "plaćeni dopust") is not
  annual leave, and the absence report must show the difference.
- **D3. Overtime tasks (373 h).** Recommendation: set `overtime = true` and
  map "Framer Overtime" to "Framer", "Design Overtime" to "Design" and
  "Development (Overtime)" to "Development". The flag exists for this.
- **D4. Former employees (50 people).** The time report has no email for them.
  Recommendation: a placeholder `first.last@harvest-import.invalid` (the
  `.invalid` domain can never receive mail), archived, `emailVerified = false`.
  The admin can type a real email on the review screen.
- **D5. Rows after today.** The last row is on 2026-09-14. Recommendation:
  import future absence rows (planned vacation), and skip future work rows.
- **D6. Rounding.** Recommendation: the nearest 15 minutes, with a minimum of
  15 minutes (+98 h in total). Rounding up adds 1,959 h.
- **D7. Mixed billability (about 22,500 h).** Recommendation: accept the loss
  and show it on the Projects tab. The alternative is one project split into
  two, which changes the history that people know.
- **D8. A second import.** Recommendation: "replace" mode for the date range of
  the file. It deletes the rows of earlier runs in that range (only rows with an
  `import_key`, never hand-made rows), then imports again. Use it once, at
  cutover.
- **D9. Reminders.** An imported active person is a `member`, so the reminder
  jobs include them. They have no push subscription, so the log reminder does
  not reach them. A Slack match ("Re-match people") would make them receive
  Slack nudges. Recommendation: accept this, because after cutover this is the
  wanted result.
