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
- Pause and resume are IN, by the owner's decision of 17 September 2026. They
  were out in the first version of this record, for the reason the amendment
  below answers.
- Issue #75 also earmarks the number 0003 for an ADR. This one took it first.

## Amendment, 17 September 2026 — a timer can be held

The first version of this record refused pause and resume, on the grounds that
a pause makes a timer hold a total as well as a start, and that two entries an
hour apart say the same thing. The owner asked for a pause that can last
indefinitely. That is the decision; this is what it costs and how the cost is
paid.

- **A timer is a chain of running segments.** `running_timer` carries
  `running_since` (when the current segment began, null while held) and
  `accumulated_seconds` (what the finished segments came to). The elapsed
  figure is the sum, so a held timer measures nothing for as long as it is
  held.
- **`started_at` is never rewritten**, not even by a resume. The cheaper
  implementation — move `started_at` forward by the length of each pause and
  keep one field — reads the same on a screen and lies about the day: a timer
  held over a night would file the previous morning's work on the following
  day. The day the entry lands on is still the day the work began.
- **This is not a second duration model.** The entry is still one date and one
  duration in 15-minute steps, and `confirm` still writes it through
  `timeEntriesService.create`. What a pause changes is which wall-clock seconds
  are counted, and nothing about what is written.
- **The cap does not apply to a held timer.** `jobs/timer-sweep.ts` reads only
  timers with a running segment. The cap is a limit on measured time; a held
  timer cannot grow into it, and holding one is a thing somebody chose rather
  than a thing they forgot.
- **Opening the Log dialog holds the clock**, which is why that dialog offers
  Discard, Resume and Log rather than Discard and Log. A figure somebody is
  correcting must not grow while they type, and opening the form to look at it
  is not a decision to stop.

## Amendment, 22 September 2026 — a timer may start from a figure

Issue #107 asked for a head start, for a timer somebody forgot to start, and
for a timer that continues an existing entry, as Harvest's does. Both are in.

- **The entry model still does not change.** A continued entry is rewritten
  through `timeEntriesService.update`, so the day's 24 hours, the note and the
  15-minute step apply exactly as they do to an edit in the form.
- **Nothing is written between starting and confirming**, as before. Starting
  on an entry does not touch the entry; only confirming does, and discarding
  leaves it as it was.
- **The cap stays a limit on the clock.** A head start is part of the clock's
  figure and counts towards it; an entry's own hours are not, because nobody
  forgot them.
