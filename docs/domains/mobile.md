# Mobile push

The server side of native push to the mobile app: the phone table, the
`native` channel in `notify`, and the timer's Live Activity. The decisions are
in `docs/adr/0006-push-relay.md` and `docs/adr/0005-native-mobile-app.md`. The
relay and its API are in `apps/push-relay/README.md`. The encryption contract
is in `packages/push-crypto`.

## The pieces

| File | What it is |
|---|---|
| `packages/core/src/db/schema/mobile.ts` | `mobile_device`, one row for each phone of a person |
| `packages/core/src/services/mobile-devices.service.ts` | Register, update, remove. Per person, so each function takes a `PersonCtx` |
| `packages/core/src/services/native-push.ts` | The transport: alerts for `notify`, and the timer changes |
| `packages/core/src/lib/push-relay.ts` | One push to the relay, and its answer as a `RelayOutcome` |
| `packages/core/src/services/notify.ts` | The `native` channel and the rule for the Slack kinds |
| `apps/web/src/routes/api/v1/me/devices/` | `POST`, and `PATCH` / `DELETE` on `$installationId` |
| `apps/web/src/routes/api/v1/orgs/$orgSlug/preferences/notifications.ts` | `GET` and `PATCH` of the person's settings, `remindersChannel` included |
| `packages/core/src/test/fake-relay.ts` | A relay on localhost for the tests |

## The switch

Nothing goes out, and nothing is read, while `PUSH_RELAY_ENABLED` is off. It
is an instance setting (ADR 0004) and is off by default. `PUSH_RELAY_URL`
names the relay, `https://push.farmer.profi.co` by default. `GET /api/v1/meta`
answers `pushRelay: { enabled, url }`, and the app registers with the relay
only when `enabled` is true. A server from before this feature sends no
`pushRelay`, and the app reads that as off.

## The phone table

`mobile_device` is unique on `(user_id, installation_id)` and has **no
`organization_id`**. It is the third deliberate exception to the tenancy rule,
after `push_subscription` and `running_timer`: a phone belongs to a person,
and the timer is one for each person across workspaces. `notify` still names
an organization for each message and checks the membership first.

- **The row belongs to a session.** `session_id` is a foreign key to the
  better-auth `session` table with `on delete cascade`. Sign-out
  (`DELETE /api/v1/session`), a revoke on Preferences and the deletion of an
  expired session all remove the phone. A send also skips a row whose session
  has expired but is not deleted yet.
- **Only a session token can register**, as `Authorization: Bearer
  <session token>`, whichever sign-in made the session. An API token has no
  session and gets a 403. A cookie cannot write on `/api/v1/me`, as for
  `DELETE /session`, so a session that `@better-auth/expo` keeps as a cookie
  must go in the `Authorization` header for these routes.
- **Registration is an upsert.** The app sends `POST /api/v1/me/devices` each
  time it comes to the foreground. A second registration replaces the row in
  full: the session, the relay id, the key and the platform.
- **One phone has one relay id.** A registration deletes each row of another
  person or installation with the same relay id, so a phone that changed
  hands does not get the last person's pushes.
- **The public key is checked at registration.** The service seals a test
  value with it, so a key that is not a P-256 point is refused then, and not at
  the first push. A 64-byte `x || y` key is stored as the 65-byte point.
- Not in the audit log: a phone changes no workspace, as a web push
  subscription does not. `audit-coverage.test.ts` holds the reasons.

## The channel

`native` is one more channel in the `KINDS` table of `notify.ts`.

| Kind | Channels |
|---|---|
| `log-reminder` | web push and native |
| `timer-dropped` | Slack, web push and native |
| `compliance-nudge`, `month-end`, `admin-digest` | Slack, or native instead (see below) |

**The app takes the Slack kinds from Slack.** A kind with `appInsteadOfSlack`
goes as a native push when all of these are true:

1. `PUSH_RELAY_ENABLED` is on.
2. The person's `remindersChannel` in this workspace is `app` (the default).
   It is a column of `notification_settings`, so it is set for each workspace.
3. A live phone of the person has `notifications_allowed`.

When every native push to the person fails, that message goes to Slack. The
outcome then reports `native: false` and the Slack result.

The alert payload is `{ kind, title, body, url? }` as JSON, sealed for each
phone with `sealForDevice` and `PUSH_INFO`. The relay forwards at most 3,072
base64url characters, so the body is cut to fit (`fitAlert`), at a character
boundary and with an ellipsis.

Each sealed payload, alert or timer, also has the freshness fields of
`@farmer/push-crypto/freshness`: `pushKind` (the relay `kind` of the push),
`sentAt` (Unix milliseconds) and `id` (12 random base64url characters). The
app and the iOS Notification Service Extension refuse a payload whose
`pushKind` is not the kind of the push that brought it, that is older than 24
hours, or whose `id` is in the last 50 that they accepted. Thus the relay
cannot send an old sealed value again.

### The relay's answers

| Answer | What the server does |
|---|---|
| `200`, `202` | Delivered. |
| `404` `unknown_relay_id`, `410` `device_gone` | Deletes the row. The app registers again in the foreground. A `404` or `410` without that code is a failure, and the row stays. |
| `409 activity_gone` | Clears `live_activity_token`. A timer start then sends a push-to-start. |
| `409 start_token_gone`, `no_start_token` | Keeps the row. No activity opens. |
| `429`, `5xx`, a timeout | Logs it and counts it as failed. |

## The Live Activity

`timersService` tells the phones after each change of the timer: start,
update, pause, resume, confirm and discard. `jobs/timer-sweep.ts` does the
same when it drops a timer. The call is `publishTimerChange`. It returns at
once, the send runs after the write commits, and a failure is logged and
never thrown. A relay that is down cannot fail or slow a timer write. The
sends of one person go in order, so a pause and a resume a second apart reach
the phone in that order.

**The content state** is not encrypted, because iOS reads it directly. It
holds numbers and the workspace slug only:

```json
{ "state": "running", "runningSinceMs": 1790000000000, "accumulatedSeconds": 1200, "workspace": "acme" }
```

- `runningSinceMs` is Unix milliseconds, never a Swift `Date`. It is the
  server's clock at the change, and `accumulatedSeconds` is the figure at that
  moment. The widget shows `accumulatedSeconds + (now - runningSinceMs) / 1000`.
- While held, `state` is `held` and `runningSinceMs` is null.
- The project, the task and the workspace name go in the sealed ciphertext,
  as `{ kind: "timer", event, workspace, project, task }`.

**iOS** gets `kind: "liveactivity"`:

| Change | With a token | Without a token |
|---|---|---|
| start | `update` with the token. On `activity_gone`, clear it and send a push-to-start | push-to-start (`start`, `TimerAttributes`, `{ version: 1 }`) |
| update, pause, resume | `update` | nothing: the app has not sent the token of its activity yet |
| confirm, discard, drop | `end`, with `dismissalDate` now, then the token is cleared | nothing |

Only a real start opens an activity. A pause that went out as a push-to-start
before the app sent its new token would open a second activity. After a
push-to-start, the app sends the new activity's token with
`PATCH /api/v1/me/devices/$installationId`.

**Android** has no per-activity token, and the relay refuses an update or an
end without one. So an Android phone gets `kind: "data"` for each change, with
the whole state sealed: `{ kind: "timer", event, ..., state: <content state> }`.
The app builds the ongoing notification itself. A phone without
`notifications_allowed` gets nothing, because Android 13 and later shows no
notification without the permission.

## Tests

`services/mobile-devices.test.ts` and `services/native-push.test.ts`. The
second starts `test/fake-relay.ts`, a relay on localhost, and points the
instance settings at it. The server makes a real HTTP call, and each test
opens the sealed payload with the phone's private key. Use
`settleNativePushForTests()` to wait for the timer sends before an assertion.

## Open points

- ADR 0005 makes `@better-auth/expo` the main sign-in, and the device flow the
  fallback. The phone routes take the session only as a bearer token. The app
  must send it so, or the routes must learn to read the cookie on a write.
- The Slack reminder job skips a workspace with no Slack installation, so the
  Slack kinds do not reach the app in such a workspace.
- `remindersChannel` has no control in the web app yet. The API and the server
  function of Preferences accept it.
