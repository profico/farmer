# The stopwatch

Measure an hour as it happens, instead of estimating it at 18:00. Issue #59
asked for it in the web app and issue #43 in the CLI; both drive one row.

**Read `docs/adr/0003-stopwatch-is-an-input-method.md` first.** It holds the two
decisions everything below depends on: the time entry does not change, and
nothing is written until a person confirms a duration.

## The pieces

| File | What it is |
|---|---|
| `packages/core/src/db/schema/timer.ts` | `running_timer` (unique on the PERSON) and `timer_settings` (the per-person cap) |
| `packages/core/src/schema/timer.ts` | The Zod inputs. `confirmTimerInput` carries the entry's own rules |
| `packages/core/src/services/timers.service.ts` | `get`, `start`, `update`, `confirm`, `discard`, `settings`, `setSettings` |
| `packages/core/src/jobs/timer-sweep.ts` | Drops a timer past its owner's cap. Writes no entry |
| `packages/core/src/api/timer.ts` | `ApiTimer` and `toApiTimer` — the REST projection |
| `apps/web/src/server/timer.ts` | The server functions |
| `apps/web/src/routes/api/v1/orgs/$orgSlug/timer/` | The CLI's four routes |
| `apps/web/src/hooks/use-timer.ts` | One query for every surface, plus the one-second tick |
| `apps/web/src/components/time/timer-row.tsx` | The sidebar row and the button beside "Log time" |
| `apps/web/src/components/time/timer-dialogs.tsx` | Start, Stop-and-log, and the dropped notice |
| `apps/web/src/components/time/timer-settings.tsx` | The cap, on Settings → Preferences |
| `apps/cli/src/commands/timer.ts` | `farmer start`, `farmer stop`, `farmer timer`, `farmer timer discard` |

## The states

```
(none) --start--> RUNNING --stop--> [the entry form] --save--> a time entry, row gone
                    |                      |
                    |                      +--cancel--> RUNNING
                    +--discard--> row gone
                    +--the sweep, past the cap--> DROPPED --dismiss--> row gone
```

There is no stored state between stopping and saving. The form is a form.

## The four rules

1. **One timer per person.** `running_timer` is unique on `user_id` alone, and
   `timersService.get` reads by `user_id` alone. This is the one deliberate
   exception to "tenancy is a parameter" in this repository, and the header of
   `db/schema/timer.ts` says why: two clocks over one hour is double-counted
   time, and a timer hidden by a workspace boundary tells a person that nothing
   is running while something is. Every function still takes a `Ctx`, and every
   function that writes still names the organization.
2. **`confirm` is one transaction.** It calls `timeEntriesService.create` and
   deletes the row together. Everything that can refuse the entry refuses the
   whole thing and the timer survives: an archived task, a missing note, a day
   already holding 24 hours, an archived project. Losing a measurement to a
   message the person could have acted on is the one unforgivable bug here.
3. **The snap is `snapToQuarterHour`, and nothing else.** It rounds to the
   NEAREST quarter hour with a floor of one, so it rounds down as often as up.
   A client that rounded up would show a figure the server will not write,
   which is why `snappedSeconds` is a field of the projection rather than a
   calculation each surface repeats.
4. **A dropped timer logs nothing.** The sweep marks `dropped_at` and sends a
   notification. Nothing writes a duration nobody chose.

## Two fields that look redundant and are not

- `snappedSeconds` — see rule 3.
- `serverNow` — the instant the elapsed figure was measured against. A browser
  and a terminal each draw their own ticking figure between reads; a machine
  whose clock is five minutes fast would otherwise count five minutes the
  server will not agree to, and the number would jump when the entry saved.

## The day the entry lands on

The day the timer **started**, in the organization's timezone. A timer run
through midnight logs to the day the work began. The confirm input carries the
date rather than deriving it, so the dialog can move the entry — which is the
ordinary correction for a timer left running into the small hours.

Writing into a closed month is allowed. `automationLockedThrough` locks robots,
not people, and a person confirming a measurement is a person.

## The cap

`timer_settings.maxSeconds`, per person and per workspace, 12 hours by default;
a missing row means the default, as `notification_settings` does. Settings →
Preferences edits it. `jobs/timer-sweep.ts` runs every 15 minutes
(`TIMER_SWEEP_ENABLED`, `TIMER_SWEEP_INTERVAL_MINUTES`) and reads every running
timer with its owner's cap in one query.

A dropped timer is announced where the person works — the sidebar row, the
Stop button, `farmer timer` — and a push and a Slack message go out as well.
`notify` reaches neither a person without a granted push permission nor one
without a Slack identity, so the read path is the promise and the notification
is the courtesy.

## What is deliberately absent

- **No MCP tool and no assistant tool.** An agent should not start a wall clock
  it cannot watch.
- **No webhook event of its own.** The entry it creates emits
  `time_entry.created`, as every entry does.
- **No pause and resume.** A pause makes a timer hold a total as well as a
  start, which is a second duration model. Two entries an hour apart say the
  same thing with rules that already exist.
- **No timer without a task.** A measurement filed against nothing is another
  inbox. A timer may run without a project, and the entry is filed later, as
  any unfiled entry is.
- **No reminder while a timer runs.** The cap is the answer to forgetting.
