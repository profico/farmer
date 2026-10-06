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
| Server address: type, link, QR code | `/meta` | written |
| Sign in with an OIDC source or Google (`@better-auth/expo`) | `/api/auth/*` | written |
| Sign in with the browser (device flow) | `/api/auth/device/*` | done |
| Sign in with an API token | `/me` | done |
| Accept an invitation, see pending invitations | `me/invitations` | done |
| Accept or decline a Harvest import claim | `me/import-claims` | written |
| Create a workspace | `me/organizations` | done |
| Choose a workspace, sign out | `/me`, `/session` | done |

## Time (area: time)

| Action | API | Status |
|---|---|---|
| Day view: entries, total, week strip, date jump, holiday marks | `time-entries`, `holidays/range` | done |
| Targets strip for the week and the month | `tracking` | done |
| Home week chart with day marks | `home` | done |
| Log, edit, delete an entry | `time-entries` | done |
| Rest-of-day block (`fillsDay`), overtime toggle | `time-entries` | done |
| Repeat an entry as a recurring block | `recurring-blocks` | done |
| Copy the previous day, copy the previous week | `time-entries/copy-day`, `copy-week` | done |
| Book time off over a range | `absences` | done |
| Sync now | `sync` | done |
| Timer: start, pause, resume, stop, discard, other workspace | `timer/*` | done |
| Timer: head start, continue an entry | `timer` | done |
| Unfiled time: file, "always file these here", remove with undo | `unfiled`, `time-entries/file` | done |
| Week grid: cells, add a row, row notes, remove a row | `time-entries` | done |
| Month calendar: totals, holidays, open a day | `time-entries`, `holidays/range` | done |
| Assemble my day | `day-assembly` | done |
| Pick a calendar meeting, calendar-changed choice | `calendar/events`, `time-entries/{id}/calendar-*` | written |
| Attach GitHub commits and PRs to an entry | `github/*`, `time-entries/{id}/commits`, `pull-requests` | written |

## You (area: you)

| Action | API | Status |
|---|---|---|
| Your tasks: hide, show, show all | `preferences/hidden-tasks` | done |
| Notifications, and "send reminders to: app / Slack" | `preferences/notifications` | done |
| Filing rules: list, edit, delete | `filing-rules` | done |
| Working hours, timer limit | `working-hours`, `timer/settings` | done |
| Recurring blocks: list, create, edit, delete, the break | `recurring-blocks` | done |
| Integrations: status, connect in the browser, disconnect, switches | `integrations` | written |
| Holidays: the year | `holidays` | done |
| Absences: list, add, delete | `absences` | done |
| Rewind | `rewind` | done |
| Display: theme, Material You, dark mode, contrast, less motion | on the device | done |
| Signed-in devices, API tokens | none | owner |
| Link or unlink Google sign-in | better-auth | web link |

## Projects and reports (area: projects)

| Action | API | Status |
|---|---|---|
| List, search, sort, this month's hours | `projects` | done |
| Create, archive, restore | `projects`, `projects/{id}/archive`, `restore` | done |
| Overview figures, entries for a period | `projects/{id}/overview`, `reports/time/detail` | done |
| Settings: details, icon emoji and colour, open to the org | `projects/{id}` | done |
| Team: view, add, change role, remove | `projects/{id}/members`, `assignable` | done |
| Link GitHub repositories | `projects/{id}/repositories` | written |
| Upload a project icon | `uploads` | written |
| Reports: Time, Overtime, Tracking, Absence, drill-down | `reports/*`, `tracking` | done |
| Export CSV from a report | the report routes, shared through the system sheet | written |

## Workspace administration (area: workspace)

| Action | API | Status |
|---|---|---|
| People: list, profile, invite, resend, cancel, role, type, start date, archive, restore, confirm email, remove, team lead's people | `people/*`, `invitations/*` | done |
| Clients: list, create, rename, archive, restore | `clients/*` | done |
| Tasks: list, create, edit, archive, restore | `tasks/*` | done |
| Hour fund: year, month, clear, suggestion, prefill | `hour-fund/*` | done |
| Organization: name, timezone, week start, logo | `organization`, `uploads` | done |
| Organization policy: tracking tolerance, automation lock | `organization/policy` | done |
| Holidays: switch one off | `holidays` | done |
| Reminders: settings, preview | `reminders/*` | done |
| Workspace integrations: GitHub, Slack, the assistant key | `workspace-integrations/*`, `assistant/settings` | written |
| Webhooks: endpoints, secret, test, deliveries, resend | `webhooks/*` | written |
| Audit log: browse, filter, export, retention | `audit-log/*` | done |

## Assistant (area: assistant)

| Action | API | Status |
|---|---|---|
| Threads: list, open, rename, delete | `assistant/threads/*` | done |
| Send a message and stream the answer | `assistant/threads/{id}/messages` | written |
| Approve or decline a tool call | `assistant/threads/{id}/approvals` | written |

## Kept on the web (ADR 0005)

The Harvest import, impersonation, platform admins and every instance setting
(sign-in sources, email, storage, integration apps, features). The More tab
links to them.

## Push and the timer surfaces (area: push)

| Action | API | Status |
|---|---|---|
| Register the device with the push relay and the server | relay, `me/devices` | written |
| Reminders as a push, "send reminders to: app / Slack" | `preferences/notifications` | written |
| Android timer notification: count, pause, resume, stop | `timer/*` | written |
| iOS Live Activity and the notification service extension | `timer/*` | written |

These rows wait for accounts of the owner: `google-services.json` for FCM, an
APNs key and an Apple team, and the relay on Coolify at
`push.farmer.profi.co`. The Android code compiles in the release build. The
iOS code has no build yet.

## The emulator run, 6 October 2026

A release build ran on the Android emulator against a local server. Each
"done" row above passed in light and dark mode, with the farmer theme and with
Material You. A "written" row needs an account that the local server did not
have (Google, GitHub, Slack, an assistant key, a webhook receiver) or a
device with a camera.
