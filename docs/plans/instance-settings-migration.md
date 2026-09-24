# Moving our own instance to database settings

Issue #75, the last box of "The configuration move". Our instance holds its
whole configuration in the environment of the Coolify deployment. This plan
moves it to the Infrastructure pages without an outage, and says what to do
before the release that brings the pages.

The rule behind every step is ADR 0004: a non-empty environment variable wins
over the database, and the page shows that field locked.

## Before the deploy

1. **Decide about registration.** The release closes registration after the
   first account (`REGISTRATION_OPEN`, default off). A person with a pending
   invitation can still sign up, and an existing account can still sign in.
   If colleagues join by signing in with Google without an invitation, set
   `REGISTRATION_OPEN=true` in the environment before the deploy. In
   single-organization mode nothing changes: that gate was already stricter.
2. **Check `BETTER_AUTH_SECRET`.** The settings are sealed with a key derived
   from it. Keep it unchanged. For a rotation, see `BETTER_AUTH_SECRETS` in
   `docs/domains/deployment.md`.

## The deploy

Nothing else is needed. The migration adds two empty tables, and every value
still comes from the environment. The Infrastructure pages show each such
field locked, with "Set by the environment".

## Moving values to the database (optional, one group at a time)

Do this per group (email, storage, GitHub, Slack, Google, push, PostHog,
feature switches), so a mistake costs one feature for a few minutes.

1. Open a shell in the web container, with its environment, and run
   `bun run settings:import-env` in `packages/core`. It copies every setting
   that the environment sets into `instance_setting`, sealing the secrets, and
   prints the names it copied. It keeps a stored value; `--overwrite` replaces
   it.
2. In Coolify, remove the variables of ONE group from the web and the worker
   services, and redeploy.
3. On the matching Infrastructure page, check that the fields are now editable
   and show the expected values. Run the page's test (storage: "Test
   connection"; email: "Send a test email"). Sign in with Google or connect
   GitHub if the group was one of those.
4. Continue with the next group.

**Rollback:** add the variables back and redeploy. The environment wins at
once, and the stored rows stay unused.

## Keep in the environment

`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NODE_ENV`, `PORT`,
and every operational value (job switches and intervals, pool settings,
timeouts, `ASSET_PRELOAD_*`, `RUN_MIGRATIONS`, `RUN_SEED`, `GIT_SHA`). The web
container and the worker container need different operational values, and
those are not settings.

## Two traps

- **The S3 endpoint and bucket.** Every stored icon and logo points into the
  current store. The Storage page refuses a change of either while files are
  stored, until you confirm it. Copy the objects first.
- **A secret cannot be read back.** Neither the page nor the database shows
  one. Run the import (step 1) before you remove a variable, or have the value
  ready to type in.
