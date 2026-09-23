# 0004 — The environment overrides the database, and the page says so

**Status:** Accepted
**Date:** 2026-09-23

## Context

Issue #75 moves the instance's configuration out of the environment and into
the database, so that a person who sets three variables gets a running
instance and configures the rest on the Infrastructure pages. Email, the S3
store, the GitHub, Slack and Google credentials, web push, PostHog, the three
feature switches, `SINGLE_ORG_SLUG` and `CLI_RELEASES_REPO` all move.

An existing deployment already holds every one of those values in its
environment, and some operators want them there: a deploy manifest is
reviewed, versioned and reproducible, and a database row is none of those.
So one value now has two sources. Two sources for one value is the classic
trap: the page shows one value, the process uses the other, and nobody can
tell which one is live.

## Decision

**One rule, one resolver.** For every setting in `INSTANCE_SETTINGS`
(`packages/core/src/lib/instance-settings.ts`):

1. A non-empty environment variable wins.
2. Else the `instance_setting` row wins.
3. Else the default in the definition answers, or nothing.

`resolveSetting(name)` returns `{ value, source, locked, lockedBy }` and is the only
place this order is written. The server reads `setting(name)`; the page reads
the same resolution through `instanceSettingsService.view()`.

- **The name of a setting is its environment variable.** The row's key, the
  variable and the field on the page are one name, so nobody translates.
- **A value from the environment locks the field.** The page renders it
  disabled with "set by the environment", and the service refuses a write to
  it. A stored value under an environment variable would do nothing today and
  would surprise somebody on the day the variable is removed.
- **A lock group locks as one.** The SMTP settings and the S3 settings each
  carry a `lockGroup`. When the environment sets one of a group, every one is
  locked, and `lockedBy` names the variable. Without it, an operator who pins
  only `SMTP_PASS` leaves `SMTP_HOST` open, and a platform admin can point the
  host at their own server and receive the password in the next AUTH command.
- **An empty variable is not set.** `.env.example` lists names with nothing
  after the `=`, and a copied file must not lock every field.
- **Secrets are sealed** with `lib/secret-box.ts` before they are written, and
  the page gets a hint (the first four characters), never the value.
- **Reads are synchronous, from a snapshot.** Each entry point awaits
  `refreshInstanceSettings()` first: the web app's global request middleware
  (`apps/web/src/start.ts`) and each scheduler tick. The refresh is cached for
  five seconds and shared by concurrent callers. So `objectStore()`, the
  feature flags and the mail transport stay synchronous and cheap, which
  matters on `/api/files` and on the 404 path of a switched-off feature.
- **A change reaches another process within the refresh interval.** The
  process that writes refreshes at once. A listener
  (`onInstanceSettingsChanged`) lets the code that builds something from a
  setting (the auth instance, the SMTP transport) rebuild it.

Operational values are not settings: the pool size, the job switches and
intervals, the timeouts, `PORT`, the `ASSET_PRELOAD_*` values, `RUN_MIGRATIONS`
and `RUN_SEED`. A web container and a worker container need different ones
out of one database, so they stay in the environment only. So do
`DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`, which are needed
before the database can be read or a secret opened.

## Consequences

- Do not add a second mechanism. A new instance-level value is a new entry in
  `INSTANCE_SETTINGS` and a `setting()` call, nothing else. A reader that goes
  to `process.env` directly for one of these names skips the database half and
  shows the page a value the process does not use.
- A code path that is not a request and not a scheduler tick (a script, a
  one-off job) must await `refreshInstanceSettings()` before it reads a
  setting, or it reads the environment and the defaults only.
- Removing a variable from the environment makes the stored value live again,
  without a restart for most settings and within the refresh interval.
- Operators who want the old behaviour keep it: set everything in the
  environment and every field is locked.
