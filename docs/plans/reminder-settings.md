# Plan: reminder settings

Status: built, not committed. Sections 2 to 5 are done: migration
`0040_reminder_settings`, the service, the job changes, the `notify.ts` gates,
the tests (`packages/core/src/jobs/reminders.test.ts`) and the page
(Settings → Reminders).

Why: the Harvest import (`docs/plans/harvest-import.md`) creates people who
have never signed in. The owner asked for:

1. a toggle that controls whether those people get reminders, off by default;
2. settings in the UI for each reminder: when to send it, and on which
   conditions.

## 1. The reminders today

| Reminder | Channel | When | To whom | Condition |
|---|---|---|---|---|
| `log-reminder` | Push | Every tick (30 min) after the person's workday ends | Every member | Logged today < the day's target. Not on a holiday or a day off. |
| `compliance-nudge` | Slack DM | Tue and Fri, from 09:00 | The compliance cohort | No entry for `complianceMissingDays` working days (default 3), or behind pace (below about 90%). |
| `month-end` | Slack DM | The last working day of the month, from 09:00 | The compliance cohort | None. |
| `admin-digest` | Slack DM | Tue, from 09:00 | Owners and admins | None. |

Facts from the code:

- `jobs/log-reminders.ts` and `jobs/slack-reminders.ts` run the reminders.
  `services/notify.ts` sends them, and its `KINDS` table gives the channels.
- The days, the 09:00 time and the 90% threshold are constants
  (`REMINDER_WEEKDAYS`, `EARLIEST_SEND_LOCAL_TIME`). The comments say that they
  are "deliberately NOT a setting", because frequent reminders get muted. This
  plan changes that decision, on the owner's request. The limits in section 3
  keep the reason for the old decision.
- The only per-person setting is `notificationSettings.logReminders` (push
  only). Preferences shows it.
- The compliance cohort leaves out archived and overhead people.
  `log-reminders.ts` does not: it selects every member, archived people too.
- Idempotency: `notificationSettings.lastLogReminderDay` for push, and a claim
  in `slack_reminder_log` for each (org, person, kind, day) for Slack.
- The Slack job ticks every 60 minutes. So "09:00" means "on the first tick
  from 09:00", which can be 09:59.

## 2. The settings

One row per org in a new table, `reminder_settings`. A missing row means the
defaults. **The defaults are the same as today's behaviour**, except for item
2.5. So the deploy changes nothing by itself.

All times are in the org timezone.

### 2.1 Log reminder (push)

| Setting | Default |
|---|---|
| On | Yes |
| When | At the end of the person's workday. Other choice: a fixed time (HH:mm). |
| Condition | Logged today is below N% of the day's target. N = 100. |

The job always skips holidays and days that are not working days for the
person. A person can still turn it off in Preferences.

### 2.2 Slack nudge

| Setting | Default |
|---|---|
| On | Yes |
| Days | Tue, Fri |
| Time | 09:00 |
| Condition "no entries" | On. N working days = 3. |
| Condition "behind pace" | On. Below P% of Expected so far. P = 90. |
| Member types | Billable, contractor |

The N for "no entries" is `orgSettings.complianceMissingDays`. The compliance
report uses the same value, so there is one field, not two.

### 2.3 Month-end reminder (Slack)

| Setting | Default |
|---|---|
| On | Yes |
| Day | The last working day. Other choice: N working days before it. |
| Time | 09:00 |
| Condition | Everyone. Other choice: only people who are behind pace. |
| Member types | Billable, contractor |

### 2.4 Admin digest (Slack)

| Setting | Default |
|---|---|
| On | Yes |
| Day | Tue |
| Time | 09:00 |

### 2.5 Who can get a reminder

| Setting | Default |
|---|---|
| Remind people who have never signed in | **Off** |

- "Never signed in" = the user has no `account` row. Only an imported person
  can match. An invitation does not make a user row, and a development
  password sign-in makes an `account` row.
- An archived member never gets a reminder. This is not a setting. It also
  fixes the log reminder, which sends to archived people today.
- `notify.ts` applies both rules for all reminder kinds, so the rules are in
  one place. Budget alerts are not reminders and do not change.

## 3. Limits

These limits keep the reason for the old "not a setting" decision:

- A person gets each kind a maximum of one time each day. The current claims do
  this.
- The Slack nudge can go out on a maximum of 3 days each week.
- Nothing goes out between 20:00 and 07:00.
- The form shows each limit next to its field. The Zod schema and a database
  check enforce it.

## 4. Architecture

- `db/schema/settings.ts`: `reminder_settings`, with typed columns (no JSON):
  `logEnabled`, `logMode` (`end_of_day` | `fixed`), `logTime`, `logBelowPct`,
  `nudgeEnabled`, `nudgeWeekdays` (`smallint[]`), `nudgeTime`,
  `nudgeNoEntries`, `nudgeBehindPace`, `nudgeBehindPacePct`,
  `nudgeMemberTypes`, `monthEndEnabled`, `monthEndDaysBefore`, `monthEndTime`,
  `monthEndOnlyBehind`, `monthEndMemberTypes`, `digestEnabled`,
  `digestWeekday`, `digestTime`, `includeNeverSignedIn`. Change the
  `orgSettings` comment that lists the reminder days as "not configurable".
- `schema/reminder-settings.ts`: the Zod input, with the limits of section 3.
- `services/reminder-settings.service.ts`:
  - `get(ctx)` returns the defaults when there is no row.
  - `update(ctx, patch)` requires an admin.
  - `preview(ctx, kind, date)` returns the people who would get this reminder
    on that date, and why, but sends nothing.
- The jobs: split each job into "select the recipients" and "send". The job
  and `preview` use the same select function, so the preview is always
  correct.
- The Slack job interval changes from 60 to 15 minutes, so the time setting is
  accurate to 15 minutes. Before the compliance queries, add a fast check: "is
  a reminder due in this org now, and not yet claimed?". Without it, the job
  runs the queries 4 times each hour.
- `notify.ts`: the archived gate and the never-signed-in gate (2.5).
- `apps/web`: a server function file, a query factory with a key from
  `queryKeys(orgSlug)`, and the page `settings/reminders.tsx` (admin only) with
  a row in `settings-nav.tsx`. It has one card for each reminder: the switch,
  day chips, a time field, the conditions, and a "Who gets this today" link
  that opens the preview.

## 5. Tests

- The defaults give the same result as today, for each kind (a regression pin).
- Days, time and conditions: a reminder goes out only when all of them apply.
- A never-signed-in person gets nothing when the toggle is off, and gets a
  reminder when it is on.
- An archived person gets nothing, for every kind.
- `preview` returns the same people that the job sends to.
- The limits: the schema refuses 4 nudge days, and a time at 22:00.

## 6. Out of scope

- Per-person settings for the Slack reminders. Today a person can turn off
  only the push reminder.
- Email as a channel.
- Budget alerts.
