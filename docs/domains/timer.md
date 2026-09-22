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
| `packages/core/src/services/timers.service.ts` | `get`, `start`, `update`, `pause`, `resume`, `confirm`, `discard`, `settings`, `setSettings` |
| `packages/core/src/jobs/timer-sweep.ts` | Drops a timer past its owner's cap. Writes no entry |
| `packages/core/src/api/timer.ts` | `ApiTimer` and `toApiTimer` — the REST projection |
| `apps/web/src/server/timer.ts` | The server functions |
| `apps/web/src/routes/api/v1/orgs/$orgSlug/timer/` | The CLI's six routes |
| `apps/web/src/hooks/use-timer.ts` | One query for every surface, plus the one-second tick |
| `apps/web/src/components/time/timer-row.tsx` | The sidebar control card and the button beside "Log time" |
| `apps/web/src/components/time/timer-dialogs.tsx` | Start, Stop-and-log, and the dropped notice |
| `apps/web/src/components/time/timer-settings.tsx` | The cap, on Settings → My schedule |
| `apps/cli/src/commands/timer.ts` | `farmer start`, `continue`, `pause`, `resume`, `stop`, `timer`, `timer discard` |
| `apps/web/src/components/time/entry-block-row.tsx` | The Start button on each entry, which continues it |

## The states

```
(none) --start--> RUNNING <--resume-- HELD
                    |  |                ^
                    |  +----pause-------+
                    |
                    +--stop--> HELD + [the entry form] --save--> a time entry, row gone
                    |                      |
                    |                      +--resume--> RUNNING
                    |                      +--discard--> row gone
                    +--discard--> row gone
                    +--the sweep, past the cap--> DROPPED --dismiss--> row gone
```

There is no stored state between stopping and saving. The form is a form, and
the row behind it is a held timer — closing the form any other way leaves it
held, and every surface says so.

## The five rules

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
5. **A held timer measures nothing, for as long as it is held.** The elapsed
   figure is `accumulated_seconds` plus the segment that is running, and a held
   timer has no running segment. `started_at` is never moved by a pause, so the
   entry still lands on the day the work began. The sweep skips a held timer
   entirely — see The cap below.

## Three fields that look redundant and are not

- `snappedSeconds` — see rule 3.
- `task.needsDescription` — the task's note rule, answered by the server. The
  CLI cannot read `lib/task-rules` at all (its import boundary is linted), and
  a client that asks for a note the task does not need is as wrong as one that
  logs without a note the task does. `farmer stop` reads this to decide whether
  an empty answer to its prompt is allowed.
- `serverNow` — the instant the elapsed figure was measured against. A browser
  and a terminal each draw their own ticking figure between reads; a machine
  whose clock is five minutes fast would otherwise count five minutes the
  server will not agree to, and the number would jump when the entry saved.

## The day the entry lands on

The day the timer **started**, in the organization's timezone — or, for a
timer that continues an entry, that entry's day. A timer run
through midnight logs to the day the work began. The confirm input carries the
date rather than deriving it, so the dialog can move the entry — which is the
ordinary correction for a timer left running into the small hours.

Writing into a closed month is allowed. `automationLockedThrough` locks robots,
not people, and a person confirming a measurement is a person.

## The cap

The cap is a limit on **measured** time, so `jobs/timer-sweep.ts` reads only
timers with a running segment. A held timer is never dropped, however long it
is held: its figure cannot grow into the cap, and holding one is a thing
somebody chose rather than a thing they forgot.

`timer_settings.maxSeconds`, per person and per workspace, 12 hours by default;
a missing row means the default, as `notification_settings` does. Settings →
My schedule edits it. `jobs/timer-sweep.ts` runs every 15 minutes
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
- **No timer without a task.** A measurement filed against nothing is another
  inbox. A timer may run without a project, and the entry is filed later, as
  any unfiled entry is.
- **No reminder while a timer runs.** The cap is the answer to forgetting.

## Not from zero (issue #107)

Two ways to start a timer that has already counted something. Both go
through `timersService.start`, and both still end in `confirm`.

- **A head start** (`headStartSeconds`): time worked before somebody
  remembered the timer. It is banked in `accumulated_seconds` as if the clock
  had measured it, and `started_at` moves back by it, because that is when the
  work began. It counts towards the cap, so `start` refuses a head start that
  is not shorter than the cap — the sweep would drop the timer on its next
  pass otherwise. Any whole second, not a quarter hour: the sum is snapped.
- **Continuing an entry** (`timeEntryId`), the way Harvest restarts a row. The
  timer takes the entry's project, task and note, and `running_timer.
  time_entry_id` points at it. The entry's duration is **joined on every read,
  never copied**: `elapsedSeconds` is the entry's hours plus what the clock
  measured, an edit to the entry while the clock runs is kept, and
  `accumulated_seconds` holds only the clock's own part — which is also why
  the cap does not count the entry's hours. `confirm` rewrites the entry
  through `timeEntriesService.update`, keeping its overtime mark, and puts it
  on the entry's day unless the person moves it. Deleting the entry sets the
  column to null (`on delete set null`), and the timer becomes an ordinary one
  that writes a new entry. A work-time block cannot be continued: its length
  is recomputed from the day, and would overwrite the clock.

Discarding a continuing timer leaves the entry as it was; only the clock's
part is thrown away.
