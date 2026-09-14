# Plan: import Harvest exports

Status: implemented, in commit 17ded91 on 2026-09-11. The owner answered D1 to
D9. The screen is at Settings → Import (`settings/import.tsx`).

This file stays as the design record, not as a task list. It holds the reasons
behind the import rules, the owner's answers, and the measurements of the real
export that those rules come from. Code comments cite it by section number (see
`services/harvest-import.service.ts`, `services/members.service.ts`,
`lib/harvest/plan.ts` and `services/harvest-import.test.ts`), so keep the
section numbers stable.

An admin drops the Harvest export files on a Settings page. The app reads the
files, shows what it will create, skip and drop, and then imports the data.

Related plan: `docs/plans/reminder-settings.md` (D9).

## 1. What the exports contain

The files are from `~/Downloads/harvest` (exported on 2026-09-11).

| File | Rows | Use |
|---|---|---|
| `harvest_time_report.csv` | 239,912 | Yes. This is the history. |
| `harvest_people_list.csv` | 64 | Yes. The only source of emails. |
| `harvest_project_list.csv` | 59 | Yes. Active projects, codes, hour budgets. |
| `harvest_task_list.csv` | 99 | Yes. Active/inactive flag for tasks. |
| `harvest_client_list.csv` | 134 | Yes, names only. |
| `harvest_all_estimates_as_pdf.zip` | 1 | No. One test estimate (42 USD). The schema has no money model. |

### The time report, measured

- 22 columns: `Date, Client, Project, Project Code, Task, Notes, Hours,
  Billable?, Invoiced?, Approved?, First Name, Last Name, Employee Id, Roles,
  Teams, Employee?, Billable Rate, Billable Amount, Cost Rate, Cost Amount,
  Currency, External Reference URL`.
- 630,211 hours, from 2014-12-30 to 2026-09-14.
- **No Harvest ID and no email on a row.** A row names a person by first and
  last name only.
- 114 people. The people list has 64 of them. **50 people exist only in the
  time report** (former employees). No two people share a name.
- 270 projects. The project list has 59 of them. **211 projects exist only in
  the time report**. No project code is used twice.
- 127 clients and 92 tasks. Every task is in the task list.
- Numbers use a decimal comma and a thousands dot (`"10.773,68"`).
- 28,022 notes have more than one line. The longest has 2,000 characters.
- 30,190 cases of more than one row for the same person, day, project and
  task. Each row stays a row.

### Durations

- 225,643 rows (94%) are on the 15-minute grid. 14,269 rows are not.
- Rounded to the nearest 15 minutes with a minimum of 15 minutes, the total
  changes by +98 hours (0.016%).
- 3 rows are longer than 24 hours, and 2 person-days have more than 24 hours.
  These are data errors. The database accepts them, but the edit dialog refuses
  an entry over 24 hours (`createTimeEntryInput`). The import skips these rows
  and the review screen lists them, so the admin can enter them by hand.
- 38 rows have negative hours (-92.42 h in total). Each is a correction of a
  row with the same person, day, project and task. The review screen asks the
  admin to subtract them or to leave them out, and the import stays blocked
  until the admin answers. "Subtract" takes the hours off the matching row (an
  exact match first, then the largest), and rounds the rest again. It also
  cancels a "40,0" row that a "-40,0" row takes back. A correction with no
  row big enough stays under "needs attention".

### Absence

- Three Harvest projects hold absence: Vacation (`PVC`, 27,483 h), Sick Leave
  (`PSL`, 2,418 h) and Paid Leave (`PPL`, 2,199 h).
- The absence tasks also occur on normal projects: Vacation (2,278 h), Sick
  leave (280 h) and Paid leave (121 h), mostly on "Profico :: Internal".

## 2. Decisions

| # | Question | Answer | Effect |
|---|---|---|---|
| D1 | Cutoff | Monday 2026-09-14, with dedupe | Section 5 |
| D2 | Paid leave | A new built-in absence task | Section 3.1 |
| D3 | Overtime tasks | Set the flag, use the base task (option A) | Section 4, "Tasks" |
| D4 | Former employees | Real `@profico.hr` addresses, archived | Section 4, "People", and 3.3 |
| D5 | Rows after today | Import, with dedupe | Section 5 |
| D6 | Rounding | Nearest 15 minutes, minimum 15 | Section 4, "Time entries" |
| D7 | Mixed billability | Finalized history closes (option C) | Section 6 |
| D8 | A second import | Replace a day if it changed, else skip it | Section 5.3 |
| D9 | Reminders | A toggle, off by default, plus reminder settings | Section 3.4 |

### D3: overtime tasks, the options

What the data shows:

- 100 rows, 373 hours, 4 people. 92 rows are on one project, "Internal ::
  PROFICO WEB 2.0", in 2024. The other 8 rows are on Nummersøk.
- 81 of the 100 rows are on days with more than 8 hours. 26 rows are on a
  weekend. So the rows are real extra hours.
- Harvest has 7,136 person-days with more than 8 hours and no overtime task
  (13,378 hours above 8), plus 1,188 weekend person-days with no overtime task.
  So in Harvest, people marked overtime on one project and nowhere else.

In this app, `overtime` is a flag on an entry. The Overtime report and the
close "Overtime" snapshot read the flag.

| Option | What happens | Result |
|---|---|---|
| A | Set `overtime = true` and use the base task: "Framer Overtime" to Framer, "Design Overtime" to Design, "Development (Overtime)" to Development. The three overtime tasks are not created. | The Overtime report shows the 373 hours. The task list stays clean. |
| B | Keep the three tasks. Do not set the flag. | The Overtime report shows 0 hours for the history. Three tasks that mean "a flag" stay in the list. |
| C | Option A, and also set the flag on untagged long days. | Rejected. The flag is a statement by the person. The import would put 13,378 hours of guessed overtime into the report, and no rule can say which entry of a long day is the extra one. |

**Decision: A.** The base tasks Framer, Design and Development exist in the
task list.

### D7: mixed billability, what it means

In Harvest, each entry has its own "Billable?" flag. In this app, an entry has
no billable flag. The project type decides: an `internal` project is
non-billable, and all other types are billable.

An example: "Erik Teigen :: Circle" has 21,646 hours. In Harvest, 12,630 hours
are billable and 9,016 hours are non-billable. After a plain import, all 21,646
hours are on a billable project, so the 9,016 hours look like billable work.
70 projects are like this, with 22,512 non-billable hours in total. ("Profico
:: Internal" is not in this count, because it becomes an `internal` project.)

There is a second, larger problem. The Utilization report does not count
entries. It reads the `Final` column of **finalized** monthly closes on
non-internal projects (`reports.service.ts`, `utilizationSpan`). The imported
months have no close. So after a plain import, utilization is 0% for every
month before the cutoff, for everybody.

| Option | What happens | Result |
|---|---|---|
| A | Plain import. | The billable split is lost. Utilization is empty for all history. |
| B | Put the non-billable rows of each mixed project on a second project, for example "Circle (non-billable)", with type `internal`. | The split is kept, but 70 extra projects appear and one project's history is in two places. Utilization is still empty. |
| C | Create a finalized close for each past month of each billable project. For each person, `Final` = that person's Harvest billable hours for that project and month. | The split is kept in the place that this app uses for "what went on the invoice". Utilization, Variance and Not-on-invoice work for the history. |

**Decision: C.** Section 6 gives the details. Size: 2,456 project-months. 886
person-months have non-billable hours on a billable project, and those show up
in the Not-on-invoice report, which is correct.

One more change is necessary for C to be useful: the org-wide Utilization
report leaves out every archived person, for all months
(`reports.service.ts`, `computeUtilization`). Without a change, the history
shows the 64 current people only, and the early years have few people. Section
3.5 changes the report so that an archived person counts for the months before
`archivedAt`.

## 3. Changes needed before the import

### 3.1 Paid Leave as a built-in absence task (D2)

- Add `paid_leave` to the `task_system_key` enum in `domain.ts`.
- **Do not use `ALTER TYPE ... ADD VALUE`.** The drizzle migrator runs every
  pending migration in one transaction (`pg-core/dialect.js`, `migrate`).
  Postgres refuses to use a new enum value inside the transaction that added
  it. So on a fresh database (the tests, CI, a new deploy) the `INSERT` of the
  task fails with "unsafe use of new value", even when the two statements are
  in two files.
- Instead, one migration rebuilds the type. Run `drizzle-kit generate` (it
  writes the snapshot), then replace the SQL in the generated file:
  1. `ALTER TYPE task_system_key RENAME TO task_system_key_old`;
  2. `CREATE TYPE task_system_key AS ENUM (...)` with the six values;
  3. `ALTER TABLE task ALTER COLUMN system_key TYPE task_system_key USING
     system_key::text::task_system_key`;
  4. `DROP TYPE task_system_key_old`;
  5. `INSERT` the site task: name "Paid Leave", `is_absence = true`,
     `system_key = 'paid_leave'`, `ON CONFLICT DO NOTHING` (migration 0024 is
     the pattern).
  All five statements are legal in one transaction. Only `task.system_key`
  uses the type.
- The migration, not only `seed-tasks.ts`, makes sure that production, a new
  database and the test database all get the task.
- Add it to `db/seed-tasks.ts`, `ABSENCE_TASK_NAMES` and `AbsenceKind`
  (`tasks.service.ts`), and to the `list_tasks` text in `assistant-tools.ts`.
  Change the comments that say "the two built-in absence tasks".
- What works with no more change:
  - The Absence report selects its columns by system key and orders them by
    creation date. Paid Leave becomes the third column.
  - The Book-time-off dialog lists all absence tasks.
  - The ledger, the close and Expected use `isAbsence`. So Paid Leave lowers
    Expected, as Vacation does.
- Tests: find each fixture that counts or lists the absence tasks.

### 3.2 Archived rows in a closed section (D4)

The import adds 50 archived people, 211 archived projects and many archived
clients and tasks. So each list page must show the active rows first, and put
the archived rows in a section below them that is closed by default.

The current state:

| Page | Now |
|---|---|
| `projects/index.tsx` | Filter pills All / Active / Archived. The default is All. |
| `settings/clients.tsx` | One list. A status pill on each row. |
| `settings/tasks.tsx` | Archived rows are hidden. A "Show N archived" button in the header shows them. |
| `settings/members.tsx` | One list. Archived rows are dimmed. |

The change:

- Add one shared component, `components/archived-section.tsx`. Below the table
  it shows a row "Archived (N)" with a chevron. It is closed by default. The
  open state is a search parameter (`?archived=1`), so a reload and the Back
  button keep it.
- If a search matches only archived rows, the section opens.
- Use it on the four pages. On the projects page, remove the three pills,
  because the section does the same job.
- On the members page, change the comment "a hidden row is a row nobody can
  undo". The row stays one click away, so Restore stays possible.
- During the work, check the other lists that have an archive action, for
  example the not-on-invoice status options on the Organization page.

### 3.3 Sign-in for an imported former employee (D4)

A fact from the code: an archived member can still sign in and use the
workspace. `access.service.ts` and `server/auth.ts` do not read
`memberProfile.archivedAt`.

The import guesses the addresses of former employees (section 4, "People").
A guessed address can be wrong, or it can belong to a different, current
person. If that user row has `emailVerified = true`, the first Google sign-in
with that address opens the old account.

So:

- An imported user with a **guessed** address gets `emailVerified = false`.
  better-auth then refuses to link a Google sign-in to it
  (`requireLocalEmailVerified`), and the person cannot sign in.
- An imported user with an address **from the people list** gets
  `emailVerified = true`, so the first Google sign-in works.
- An address that the admin **types** on the review screen is not a guess.
  The admin vouches for it, so it also gets `emailVerified = true`
  (`emailConfirmed` on the person plan).
- Members → Restore on an imported person who has never signed in shows the
  address and asks the admin to confirm it. Then it sets
  `emailVerified = true`.
- Members → "Confirm email" does the same for an active member whose address
  is not confirmed, with the same checks as Restore. Before this, the only
  path was to archive the person and then restore them.

### 3.4 Reminders (D9)

Two parts, both in `docs/plans/reminder-settings.md`:

- A toggle "Remind people who have never signed in", off by default. "Never
  signed in" means the user has no `account` row. Every imported person
  matches, until they sign in for the first time.
- Settings in the UI for each reminder: on or off, which days, what time, and
  which conditions and people.

### 3.5 Utilization and archived people (D7)

`computeUtilization` filters with `archived.has(userId)`, a set from
`membersService.archivedUserIds`. Change it to a map of `userId` to
`archivedAt`, and leave a person out of a month only when the month starts on
or after `archivedAt`. The single-person view does not change. The trend uses
the same function, so it changes with it. A test pins it: a person archived in
March counts in February and not in April.

## 4. Mapping rules

### Clients

- One client for each distinct client name in the time report and the client
  list. Match an existing client by name (case and spaces ignored).
- "Profico" and "Internal" map to the org's internal client
  (`clientsService.ensureInternal`). The review screen can change this.
- A client with no active project is created archived.
- The address is dropped.

### Projects

- One project for each distinct (client, project, code) in the time report.
- Status: `active` if the project is in the project list, else `archived`.
- Suggested type (the admin can change it):
  - only non-billable rows: `internal`;
  - `Budget By = Hours`: `fixed_scope`, with `Budget` in `budgetSeconds`;
  - all others: `product_team`.
- Code: the Harvest code, cut to 16 characters.
- Dropped: notes, dates, amounts, costs, expenses.
- The absence projects (`PVC`, `PSL`, `PPL`) are not created. Their rows become
  absence entries.

### Tasks

Match by name (case and spaces ignored), in this order:

1. Site tasks: "Meeting" to Meeting, "Break" and "Daily Break" to Break.
2. Absence: "Vacation" to Vacation, "Sick leave" to Sick Leave, "Paid leave" to
   Paid Leave.
3. Overtime (D3, option A): "Framer Overtime" to Framer, "Design Overtime" to
   Design, "Development (Overtime)" to Development, and set the flag.
4. Existing org tasks, including "Development" (the `development` key).
5. Else create an org task. `Active? = No` makes it archived.

### People

A person is keyed by email when the people list has one, else by full name.

- **An existing member with the same email:** match. Change nothing, except a
  profile field that is empty.
- **A person in the people list who is not a member:** create `user`,
  `member`, `memberProfile`, `memberTypeHistory` and `memberSchedule`.
  - `emailVerified = true` (section 3.3).
  - Role: `admin` if Harvest `Admin = Yes`, else `member`. The Harvest Owner
    also becomes `admin`, because the org already has an owner.
  - Type: `contractor` if `Employee? = No`, else `billable`. The admin can set
    `overhead` on the review screen. The type starts on the date of the first
    entry.
  - `startDate` = the date of the first entry.
  - `weeklyTargetSeconds` = `Capacity` x 3600.
- `user.id` and `member.id` are text columns with no default. The import makes
  them with better-auth's `generateId`, so they have the same form as the
  rows that a sign-in makes.
- **A person only in the time report (50 people):** the same rows, archived
  (`archivedAt` = the day after the last entry), with a guessed address.
  - The guess is `{first letter of the first name}{last name}@profico.hr`, in
    lower case, with no diacritics (`č ć` to `c`, `đ` to `d`). 41 of the 64
    current people have this form. 17 have `{first name}@`, and 6 have other
    forms.
  - The review screen marks each guess, and the admin can change it.
  - A guess that is the same as an existing user, a person in the people list
    or another guess is blocked. The admin must change it.
  - `emailVerified = false` (section 3.3).
- **Two names that are the same without accents and punctuation** ("Ive
  Vasiljević" to 2020, "Ive Vasiljevic" from 2021): the review screen asks if
  they are one person or different people, and the import stays blocked until
  the admin answers. "One person" merges the rows into the chosen name. The
  other name gets an `alias` plan, and `start` maps it to the same user. Undo
  removes only that mapping. When an earlier run mapped every name of the
  group, the screen does not ask again.
- Dropped: rates, roles, teams, employee ID.

### Project members and project tasks

The exports have no assignments. Make them from the time report:

- `projectMember` for each (project, person) pair with a row. Role `member`.
  `active = true` only if the project and the person are active and the pair
  has a row in the 90 days before the cutoff.
- No per-project task rows: since Sept 2026 every project offers every live
  task of the org, so the (project, task) pairs in the export are not stored.

### Time entries

- `date` = `Date`. `description` = `Notes`.
- `durationSeconds`: round to the nearest 900 seconds, with a minimum of 900
  (D6). Skip a row over 24 hours (section 1).
- Absence: when the task or the project is an absence one, the entry takes the
  absence task and `projectId = null`.
- `overtime`: `true` for the three overtime tasks (D3), else `false`.
- `fillsDay = false`, `syncLocked = true`.
- Dropped: `Billable?` (but see section 6), `Invoiced?`, `Approved?`, rates,
  amounts, currency, `External Reference URL`.

## 5. Cutoff, dedupe and a second import

### 5.1 Which rows

The cutoff is Monday 2026-09-14. From that day, people log time in this app.

- A work row dated **before** the cutoff: import it.
- A work row dated **on or after** the cutoff: skip it.
- An absence row: import it on every date, including future dates (D5).

### 5.2 Dedupe against entries in this app

A row that a person made in this app (a row with no `import_key`) is never
changed or deleted by the import.

1. **Absence.** Skip a Harvest absence row if the person already has an
   absence entry on that day. If the two kinds are different (for example
   Vacation in Harvest, Sick Leave here), the review screen lists it.
2. **An exact work row.** Skip a Harvest work row if the person has an entry on
   the same day with the same project, task and rounded duration. Count them as
   a multiset: two Harvest rows and one match here import one row.
3. **An overlap day.** A person-day that still has Harvest work rows and also
   has work entries here. The review screen lists these days with both totals.
   For each day, or for all of them at one time, the admin chooses:
   - "Keep this app's entries" (the default): skip the Harvest rows for that
     day.
   - "Keep both": import the Harvest rows too.

   A day where the entries here are only automation rows (calendar meetings,
   recurring blocks, fill blocks) has a mark, so the admin can find these days
   and choose "Keep both" for them.

The review screen shows each count: imported, skipped as duplicate, skipped by
cutoff, overlap days.

### 5.3 A second import (D8)

The CSV has no Harvest ID. So the import compares one **person-day** at a time.

- Each imported row stores an `import_key`:
  `sha256(date, first, last, client, project, code, task, notes, hours) + ":" + n`,
  where `n` is the position among identical rows of that person-day.
- For each person-day in the new file, compare its set of keys with the keys
  that earlier runs imported for that person-day:
  - **The same:** skip the day.
  - **Different:** delete the earlier imported rows of that day, then import
    the new rows.
  - **Different, but a person edited an imported row here**
    (`updatedAt > createdAt`): keep the day as it is, and list it.
- **A person-day that has imported rows but is not in the new file** (the rows
  were deleted in Harvest): delete the imported rows. The review screen shows
  this count, and asks the admin to confirm that the file is a full export
  (all people, all projects). This step only looks at dates inside the new
  file's date range.
- Clients, projects, tasks and people use `import_mapping`, so a second run
  finds the rows that the first run made. A project that someone renamed in
  Harvest becomes a new project.

### 5.4 The cutover

1. Before Monday: do a dry run on a copy of the production database, and an
   import of the current export on production. Check the totals for each
   person and year against a Harvest report.
2. On Monday 2026-09-14, people start to log in this app.
3. When everybody has finished last week in Harvest: export again and import
   again. Section 5.3 imports only the days that changed.
4. Stop Harvest.

## 6. History closes (D7)

- On the last step there is a field, "Finalize history through". The default is
  the month before the cutoff month (August 2026).
- For each billable (non-`internal`) project and each month in that range with
  imported rows:
  - Create a `monthlyClose` with status `finalized` and `finalizedByUserId` =
    the admin who runs the import. The table has no note column; the
    `import_mapping` row (kind `close`) records that the import made it.
  - Create one `monthlyCloseRow` for each person with rows:
    - `adjustedSeconds` = null.
    - `finalSeconds` = the sum of that person's rounded **billable** rows.
    - `reportedAtFinalizeSeconds` and `overtimeAtFinalizeSeconds` = the
      imported totals.
    - `expectedAtFinalizeSeconds` = the value that finalize computes. Use the
      same function that `close.service.ts` uses, not a copy.
- Skip a month that already has a close in this app.
- Run `hourFundService.prefillYear` before this step, because Expected needs the
  monthly hour fund.
- Size: 2,456 closes.
- A second import (section 5.3) calculates `Final` again for a month where a day
  changed, but only for closes that the import made and that nobody changed
  since.
- Undo deletes the closes that the run made.

## 7. Architecture

The design follows the boundary rule: all logic in `packages/core`, thin server
functions, and the UI in `apps/web`.

### `packages/core/src/lib/harvest/` (pure, safe in the browser)

- `csv.ts`: an RFC 4180 parser that yields rows (quotes, `""`, line breaks in
  quotes, CRLF, BOM).
- `number.ts`: reads `"10.773,68"` and `"10,773.68"`.
- `detect.ts`: identifies a file from its header.
- `keys.ts`: the row key and the person-day key.
- `plan.ts`: `planHarvestImport(files, snapshot, choices)` makes the full plan.
  The review screen and the tests use it.

The browser runs the parser and `plan.ts` in a Web Worker.

### Database (migrations)

- `task_system_key` + `paid_leave`, and the Paid Leave row (section 3.1).
- `import_run`: `id`, `organizationId`, `source`, `createdByUserId`,
  `cutoffDate`, `status` (`started` | `finished` | `undone`), counts,
  timestamps.
- `import_mapping`: `organizationId`, `runId`, `kind` (`client` | `project` |
  `task` | `person` | `close`), `sourceKey`, `localId`, `created`. Unique on
  (`organizationId`, `kind`, `sourceKey`).
- `time_entry.import_run_id` (nullable FK) and `time_entry.import_key`
  (nullable), with a partial unique index on (`organization_id`, `import_key`)
  where `import_key is not null`.

### `packages/core/src/services/harvest-import.service.ts`

Every function starts with `requireAdmin(ctx)`.

- `snapshot(ctx, range)`: the existing clients, projects, tasks and members,
  the keys of earlier imports, and the entries in this app that dedupe needs
  (section 5.2).
- `start(ctx, plan)`: in one transaction, creates the run, the reference rows
  and the mappings. It checks every ID against the org, and every email for
  uniqueness.
- `importDays(ctx, runId, chunk)`: one chunk is a set of whole person-days, so
  the replace in section 5.3 stays inside one transaction for each day. Inserts
  in batches of 500. It checks every `userId`, `projectId` and `taskId` against
  the run's mappings. It is safe to retry.
- `finish(ctx, runId, options)`: `automationLockedThrough`, the hour fund, the
  history closes (section 6).
- `listRuns(ctx)` and `undo(ctx, runId)`: undo deletes the run's entries and
  closes, then the rows that the run created, in reverse order. It refuses if a
  person signed in to a user that the run created, or if a month has a close
  that somebody finalized by hand.

### `apps/web`

- `src/server/harvest-import.ts`: one server function for each service
  function, with `orgAdminMiddleware` and the deferred services import.
- `src/routes/$orgSlug/settings/import.tsx`, admin only, with a row in
  `components/settings-nav.tsx`.
- `src/components/import/`: the drop zone, the review tabs, the progress view,
  the Worker.
- `src/components/archived-section.tsx` (section 3.2).

## 8. The screen

1. **Drop.** Drop one or more files. Each file shows its kind, its row count,
   and "used" or "not used, because ...".
2. **Review.** First, "Answer these": the questions with no safe default
   (two spellings of one name, section 4; negative rows, section 1). Then the
   summary numbers. Then tabs:
   - People: name, email (guesses marked), match, role, type. A warning: a
     person with an address from the people list can sign in at once.
   - Projects: client, name, code, hours, billable and non-billable hours,
     type, status, budget.
   - Clients and Tasks: match and status.
   - Time: hours for each year, rounding change, rows that need attention
     (longer than 24 hours), the dedupe counts, the overlap days (section 5.2)
     and, on a second import, the changed and removed days (section 5.3).
3. **Import.** A progress bar. After an error, "Retry" continues from the
   failed chunk. If the tab closes, drop the file again: the keys skip what
   already exists.
4. **Done.** Counts, and a list of runs with "Undo".

## 9. Tests (`packages/core`, PGLite)

- `lib/harvest`: the parser, both number formats, file detection, the keys
  (stable, and the counter for identical rows).
- `plan.ts`: absence mapping, overtime, rounding, project types, matching,
  guessed emails and their collisions, the cutoff, every dedupe case in 5.2,
  and every case in 5.3 (same, changed, edited here, removed).
- Service: admin only; a second import of the same file adds nothing; a chunk
  with an ID from another org fails; an existing member is not changed;
  `emailVerified` is `true` for a listed address and `false` for a guess; the
  history closes have the expected `Final`; undo removes only what the run
  created.
- Paid Leave: the migration makes the task, and the Absence report shows a
  third column.
- Update the coverage list in `CLAUDE.md`.

## 10. Phases

This was the build order. Phases 1 to 5 are in the tree. Phase 6 is an
operational step, and this file does not record whether it happened.

1. Paid Leave (3.1), the archived section (3.2) and the utilization change
   (3.5). All three are small and can be used without the import.
2. `lib/harvest` and its tests. Run it on the real files and compare totals
   with a Harvest report.
3. Migration, service and tests, including dedupe and the second import.
4. Server functions and the screen.
5. Reminder settings (separate plan). The toggle must be in production before
   the import, so that nobody gets a reminder before cutover.
6. The cutover (section 5.4).

## 11. Facts checked against the code

- The drizzle migrator runs all pending migrations in one transaction
  (`drizzle-orm/pg-core/dialect.js`, `migrate`). This is why 3.1 rebuilds the
  enum type.
- better-auth refuses to link a Google sign-in to a local user with
  `emailVerified = false` (`oauth2/link-account.mjs`,
  `requireLocalEmailVerified ?? true`). The sign-in ends on the error page.
- `access.service.ts`, `server/auth.ts` and the org route do not read
  `memberProfile.archivedAt`, so an archived member can sign in.
- `notify` checks membership only. `log-reminders.ts` selects every member.
- `expectedSecondsFor` is exported from `close.service.ts`.
- Every service update path sets `updatedAt` by hand (there is no
  `$onUpdate`), so `updatedAt > createdAt` means "edited in this app".
- `project` has no unique name index per org. Four project names occur under
  more than one client ("Web", "General", "Dashboard", "Various Projects").
- Field limits: the longest project name is 47 characters (limit 120), client
  37 (120), task 37 (80), notes 2,000 (10,000).
- `time_entry` has a check for duration > 0 and a multiple of 900, but no
  24-hour cap. The 24-hour cap is in the Zod input only.
