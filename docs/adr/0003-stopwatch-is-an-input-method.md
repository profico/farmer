# 0003 — The stopwatch is an input method, not a second time model

**Status:** Accepted
**Date:** 2026-09-17

## Context

Issue #59 asks for a stopwatch in the web app, and issue #43 asks for the same
two commands in the CLI. Six comments in this codebase say that Farmer has no
timer: `db/schema/domain.ts`, `schema/time-entries.ts` twice,
`services/time-entries.service.ts`, `apps/web/src/server/time-entries.ts` and
`components/time/day-view.tsx`. They are there because the time entry is
duration-only by design (PRD 3.6): a date, an amount of time in 15-minute
steps, and no clock.

The thread on #59 carries two objections, and both are about what a clock does
to that model:

1. People forget to stop a stopwatch. A clock left running overnight is not a
   measurement of anything.
2. A stopwatch produces figures like 2:12, which Operations then has to round
   by hand before a report reads correctly.

An hour that nobody measured is also a real cost. A person who works in
fifteen fragments and writes the day down at 18:00 writes down an estimate, and
that estimate is what every report reads.

## Decision

A stopwatch that measures, and that writes nothing until a person confirms a
duration the entry model already allows.

- **The entry model does not change.** `time_entry` keeps its date, its
  duration and its 15-minute check constraint. `timersService.confirm` writes
  through `timeEntriesService.create`, so a measured hour passes the same rules
  a typed one does: the day's 24 hours, the note a task requires, an archived
  task, the fill block that has to shrink. Nothing about a timer can write a
  duration a person could not have typed into the form.
- **The measurement is snapped before anybody sees it.** `snapToQuarterHour`
  rounds to the NEAREST quarter hour with a floor of one, so 2:12 is offered as
  2:15 and 0:50 as 0:45. The figure is shown in the ordinary entry form, where
  it can be corrected, before anything is saved. That answers objection 2: a
  stopwatch never produces 2:12, because nothing in Farmer can.
- **Nothing is stored between stopping and saving.** Stop opens the form;
  Save writes the entry and clears the timer in one transaction; Cancel leaves
  the clock running. A stored "waiting to be logged" state would be a third
  to-do inbox beside `unfiled` and the filing banner, and no screen would show
  it.
- **A forgotten timer logs nothing.** `timer_settings.maxSeconds` is a limit
  each person sets on themselves, 12 hours by default, on Settings →
  Preferences. `jobs/timer-sweep.ts` marks a timer past it as dropped and
  writes no entry. That answers objection 1 in the only way that keeps a
  timesheet honest: the cost of forgetting is the measurement, never a wrong
  number somebody has to find later.
- **One timer per person, not per workspace.** `running_timer` is unique on
  `user_id` alone — the one deliberate exception to the tenancy rule in this
  repository, with `push_subscription` as the precedent. Two clocks over one
  hour would be double-counted time, and a person who cannot see the timer
  running in another workspace is told that nothing is running while something
  is. Every read answers a timer from anywhere and says which workspace it
  belongs to.
- **The row is the state, not the tab.** The timer survives a reload, a closed
  laptop and a second machine, and `farmer start` in a terminal is stopped by
  the Stop button in a browser.

## Consequences

- The six comments above are amended rather than deleted. The entry model is
  still duration-only, which is what each of them was really saying; each now
  names the stopwatch as an input method that ends in one of those rows.
- A dropped timer is announced on the read path — the sidebar row, `farmer
  timer` — and a push and a Slack message go out as a courtesy. `notify`
  reaches neither a person without a push permission nor one without a Slack
  identity, so the read path is the promise.
- The timer emits no webhook event. The entry it creates emits
  `time_entry.created`, as every entry does.
- There is no MCP tool and no assistant tool for the stopwatch. An agent should
  not start a wall clock it cannot watch, and `list_time_entries` is already
  the read an agent loop hits hardest.
- Pause and resume are out. A pause is a second duration model — a timer would
  hold a total as well as a start — and two entries an hour apart say the same
  thing with rules that already exist.
- Issue #75 also earmarks the number 0003 for an ADR. This one took it first.
