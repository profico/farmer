# The mobile app: parity with the web app

ADR 0005 asks for every screen of the web app in the mobile app, for every
role. This file lists each web screen and the actions in it. It is the
definition of "done" for phase 3.

Status values:

- **todo**: not built yet.
- **done**: the app does it, and an emulator run showed it.
- **written**: the code exists and passes typecheck, but no device ran it.
- **web link**: the app opens the web page. ADR 0005 keeps it on the web.
- **owner**: it waits for a decision or an account of the owner.

The "Area" column names the part of the app that owns the row.

## Sign-in and onboarding (area: onboarding)

| Action | API | Status |
|---|---|---|
| Server address: type, link, QR code | `/meta` | todo |
| Sign in with an OIDC source or Google (`@better-auth/expo`) | `/api/auth/*` | todo |
| Sign in with the browser (device flow) | `/api/auth/device/*` | done |
| Sign in with an API token | `/me` | done |
| Accept an invitation, see pending invitations | gap route | todo |
| Accept or decline a Harvest import claim | gap route | todo |
| Create a workspace | gap route | todo |
| Choose a workspace, sign out | `/me`, `/session` | done |

## Time (area: time)

| Action | API | Status |
|---|---|---|
| Day view: entries, total, week strip, date jump, holiday marks | `time-entries`, `holidays/range` | todo |
| Targets strip for the week and the month | `tracking` | todo |
| Home week chart with day marks | `home` | todo |
| Log, edit, delete an entry | `time-entries` | done |
| Rest-of-day block (`fillsDay`), overtime toggle | `time-entries` | todo |
| Repeat an entry as a recurring block | `recurring-blocks` | todo |
| Copy the previous day, copy the previous week | `time-entries/copy-day`, `copy-week` | todo |
| Book time off over a range | `absences` | todo |
| Sync now | `sync` | todo |
| Timer: start, pause, resume, stop, discard, other workspace | `timer/*` | done |
| Timer: head start, continue an entry | `timer` | todo |
| Unfiled time: file, "always file these here", remove with undo | `unfiled`, `time-entries/file` | todo |
| Week grid: cells, add a row, row notes, remove a row | `time-entries` | todo |
| Month calendar: totals, holidays, open a day | `time-entries`, `holidays/range` | todo |
| Assemble my day | gap route | todo |
| Pick a calendar meeting, calendar-changed choice | gap route | todo |
| Attach GitHub commits and PRs to an entry | gap route | todo |

## You (area: you)

| Action | API | Status |
|---|---|---|
| Your tasks: hide, show, show all | `preferences/hidden-tasks` | todo |
| Notifications, and "send reminders to: app / Slack" | `preferences/notifications` | todo |
| Filing rules: list, edit, delete | `filing-rules` | todo |
| Working hours, timer limit | `working-hours`, `timer/settings` | todo |
| Recurring blocks: list, create, edit, delete, the break | `recurring-blocks` | todo |
| Integrations: status, connect in the browser, disconnect, switches | `integrations` | todo |
| Holidays: the year | `holidays` | todo |
| Absences: list, add, delete | `absences` | todo |
| Rewind | `rewind` | todo |
| Display: theme, Material You, dark mode, contrast, less motion | on the device | todo |
| Signed-in devices, API tokens | none | owner |
| Link or unlink Google sign-in | better-auth | web link |

## Projects and reports (area: projects)

| Action | API | Status |
|---|---|---|
| List, search, sort, this month's hours | `projects` | todo |
| Create, archive, restore | `projects`, `projects/{id}/archive`, `restore` | todo |
| Overview figures, entries for a period | `projects/{id}/overview`, `reports/time/detail` | todo |
| Settings: details, icon emoji and colour, open to the org | `projects/{id}` | todo |
| Team: view, add, change role, remove | `projects/{id}/members`, `assignable` | todo |
| Link GitHub repositories | gap route | todo |
| Upload a project icon | gap route | todo |
| Reports: Time, Overtime, Tracking, Absence, drill-down | `reports/*`, `tracking` | todo |
| Export CSV from a report | the report routes, shared through the system sheet | todo |

## Workspace administration (area: workspace)

| Action | API | Status |
|---|---|---|
| People: list, profile, invite, resend, cancel, role, type, start date, archive, restore, confirm email, remove, team lead's people | `people/*`, `invitations/*` | todo |
| Clients: list, create, rename, archive, restore | `clients/*` | todo |
| Tasks: list, create, edit, archive, restore | `tasks/*` | todo |
| Hour fund: year, month, clear, suggestion, prefill | `hour-fund/*` | todo |
| Organization: name, timezone, week start, logo | `organization` | todo |
| Organization policy: tracking tolerance, automation lock | gap route | todo |
| Holidays: switch one off | gap route | todo |
| Reminders: settings, preview | `reminders/*` | todo |
| Workspace integrations: GitHub, Slack, the assistant key | `workspace-integrations/*`, `assistant/settings` | todo |
| Webhooks: endpoints, secret, test, deliveries, resend | `webhooks/*` | todo |
| Audit log: browse, filter, export, retention | `audit-log/*` | todo |

## Assistant (area: assistant)

| Action | API | Status |
|---|---|---|
| Threads: list, open, rename, delete | `assistant/threads/*` | todo |
| Send a message and stream the answer | `assistant/threads/{id}/messages` | todo |
| Approve or decline a tool call | `assistant/threads/{id}/approvals` | todo |

## Kept on the web (ADR 0005)

The Harvest import, impersonation, platform admins and every instance setting
(sign-in sources, email, storage, integration apps, features). The More tab
links to them.
