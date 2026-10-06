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

## The API switch

The mobile app uses `api/v1` for everything, sign-in included. `serve()` in
`apps/web/src/server/api-route.ts` answers 404 for each `api/v1` route when
`CLI_ENABLED` is false. A server with `CLI_ENABLED` off therefore gives the
app no sign-in, no timer and no device registration, and it gets no push.
Keep `CLI_ENABLED` on for each instance that serves the mobile app. The
setting has the name of the CLI for a historical reason: it switches the
whole `api/v1` surface.

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
- **The phone proves that it holds the relay id.** The body has a
  `relayProof`: an HMAC of the relay id and the public key, made from the
  relay's `deviceSecret` (`@farmer/push-crypto/binding`). The service sends it
  to `POST /v1/devices/:relayId/verify` on the relay when the installation has
  no row, or when the relay id or the key differs from its row. A wrong proof
  is refused, and no row changes. A relay that does not answer refuses a new
  binding. An unchanged registration, as on each foreground, makes no relay
  call. A new binding is also refused while `PUSH_RELAY_ENABLED` is off.
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
hours, that is more than 30 minutes in the future, or whose `id` they
accepted while its payload could still pass the age check. They keep at
most 500 ids. If the list is full, they forget the oldest and refuse each
payload that is not newer than it. Thus the relay
cannot send an old sealed value again.

### The relay's answers

| Answer | What the server does |
|---|---|
| `200`, `202` | Delivered. |
| `404` `unknown_relay_id`, `410` `device_gone` | Deletes the row. The app registers again in the foreground. A `404` or `410` without that code is a failure, and the row stays. |
| `409 activity_gone` | Clears `live_activity_token`. A timer start then sends a push-to-start. |
| `403 activity_token_unbound` or `activity_token_mismatch` | Same as `409 activity_gone`: clear the token. |
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

- The app binds the per-activity Live Activity token at the relay. The
  function `reportLiveActivityToken` in `apps/mobile/src/push/registration.ts`
  sends the token to the Server and calls `updateRelay` with
  `liveActivityToken` at the same time. The app sends `null` when the native
  event `onActivityEnded` reports that no activity is active. A failed relay
  call is logged, and the next `syncPush` sends the token again. Each
  `syncPush` also binds a running activity's token again, before it reports
  the token to the Server, because the relay can lose a binding that the app
  still remembers. The relay bind is idempotent. The app makes no relay call
  for this when no activity runs. Android
  never sends it. The relay refuses a push to a token that no device
  bound (`apps/push-relay/README.md`, "Live Activity tokens"). No one ran
  this on a device with APNs.

- ADR 0005 makes `@better-auth/expo` the main sign-in, and the device flow the
  fallback. The phone routes take the session only as a bearer token. The app
  must send it so, or the routes must learn to read the cookie on a write.
- The Slack reminder job skips a workspace with no Slack installation, so the
  Slack kinds do not reach the app in such a workspace.
- `remindersChannel` has no control in the web app yet. The API and the server
  function of Preferences accept it.

## The sign-in exchange

The provider sign-in of the app ends in a `farmer://auth-callback` link. The
link carries a one-time code, not the session (ADR 0005). The code is in
`packages/core/src/auth/mobile-exchange.ts`, and the app side is in
`apps/mobile/src/session/auth-flow.ts` and `provider-sign-in.ts`.

1. The app makes a verifier (32 random bytes, base64url) and sends its S256
   challenge as `cc` in the `callbackURL`. The verifier stays in memory.
2. `expo()` adds `cookie=<Set-Cookie>` to the redirect. The `mobile-exchange`
   plugin comes after `expo()` in the plugin list, so its after hook sees
   that link. The hook runs on the same paths as the hook of `expo()`. It
   removes `cookie` and `cc`, and adds `code`. A `cc` that is not a
   43-character challenge, no `cc`, or a callback with no new session, gives
   `error=exchange_failed` and no cookie. A callback that has an `error`
   already (a refused sign-in) keeps that error, with no cookie and no code.
3. The app calls `POST /api/auth/mobile/exchange` with `{ code, verifier }`
   and gets `{ token }`, the session token.

- **The code lives 60 seconds and works once.** The row is in `verification`,
  with the identifier `mobile-exchange:<sha256 of the code>`. The delete
  that redeems it is one statement with `returning`, so two requests cannot
  both win. A wrong verifier burns that one code and no other. Every failure
  gets the same 400 `INVALID_EXCHANGE`, and the endpoint has a rate limit of
  20 a minute for each client.
- **The session is bound by its id.** The row holds the session id, and the
  redeem reads the token from the live session. A session that ended in the
  60 seconds gives no token.
- **No audit line of its own.** The exchange makes no session. The sign-in is
  recorded as `auth.signed_in` when the session is created, as for the web.
- **The exchange is the only path.** The link never carries the session, and
  the app reads a code and nothing else from it. The app always sends `cc`.
- The password sign-in, the device flow and API tokens do not use the link
  and did not change.

## Builds

`.github/workflows/mobile-release.yml` builds the app on GitHub runners. It
does not use EAS, and it needs no Apple Developer account and no Google Play
account.

| Trigger | Result |
|---|---|
| Push to `main` that changes `apps/mobile`, `packages/api-client`, `packages/push-crypto`, `bun.lock` or the workflow | Builds both platforms. Replaces the prerelease `mobile-latest` (the old release and its tag are deleted, and made again on the new commit). |
| Tag `mobile-v<version>` | Builds both platforms. Publishes a normal release. The job fails when the tag is not the `version` of `app.config.ts`. |
| Push to `feat/mobile` | Builds both platforms. Keeps the files as workflow artifacts. No release. Remove this trigger after the mobile pull request merges. |
| `workflow_dispatch` | Builds. Releases only on `main`. |

The files of a release:

- `farmer-<version>-<versionCode>.apk` is signed with the release keystore.
  The file name ends in `-debug-signed` when a secret is missing, and the
  job prints a warning. A debug-signed APK does not install over a
  release-signed app.
- `farmer-<version>-unsigned.ipa` has no signature, for AltStore or
  SideStore. It holds the widget and the notification service extension
  (`PlugIns`). A free Apple ID gives an app that expires after 7 days and
  has no push.
- `farmer-<version>-simulator.zip` holds `Farmer.app` for the iOS Simulator.
- `SHA256SUMS`.

### The default server

`FARMER_DEFAULT_SERVER` is a build-time address. `app.config.ts` puts it in
`extra.defaultServer`, and `src/config.ts` reads it with `expo-constants`
(`defaultServerFrom` in `src/session/server-address.ts` checks it with
`normalizeOrigin`). When the app has no saved server, the Server screen
starts with this address in its field. The person taps Continue, and the
version check and the sign-in run as for a typed address. The person can
still change the address. Without the variable, or with a bad value, the
screen starts empty. The workflow sets it to `https://farmer.profi.co` for
both platforms. Remove the line in the workflow for a build with no default.

### Release notes for colleagues

The notes of each release start with the install steps for Android:

1. Download the APK from the release on the phone.
2. Open the file, and allow installs from this source.
3. Open the app. It starts with farmer.profi.co. Tap Continue and sign in
   as on the web.

To update, download the newer APK from the same release (`mobile-latest`).
It installs over the old app, because the version code goes up and the
release key is the same. Push notifications are not on yet, so the
reminders still come through Slack. The iOS notes (the unsigned IPA and the
simulator zip) stay in the "Files" list.

### The version code

`FARMER_VERSION_CODE` sets the Android `versionCode` and the iOS
`buildNumber` (`app.config.ts`). CI sets it to `github.run_number`, which
only goes up, so a new APK installs over the old one. Without the variable
the prebuild default (1) stays. The `version` is still the one in
`app.config.ts`.

### Android signing

`android/` is made by `expo prebuild` and is not in the repository.
`plugins/with-android-signing.js` adds a `release` signing config to
`app/build.gradle`. The release build type uses it when
`FARMER_KEYSTORE_PATH` is set, with `FARMER_KEYSTORE_PASSWORD`,
`FARMER_KEY_ALIAS` and `FARMER_KEY_PASSWORD`. Without
`FARMER_KEYSTORE_PATH` the build signs with the debug keystore, as before.

The repository secrets: `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
`GOOGLE_SERVICES_JSON_BASE64` is optional. Without it the build has no FCM
and the app gets no push token (`plugins/with-push.js`). Keep one release
keystore for every build. Android refuses an update that another key signed.

### iOS

The runner builds two things with no signing: a Release build for the
simulator, and an archive for a device (`CODE_SIGNING_ALLOWED=NO`). The
unsigned archive has no entitlements, so the app group and push of the app
and the extensions are not in the IPA. The signing step of AltStore or
SideStore applies the entitlements that the account allows. A free account
allows no app group, so the widget and the extension cannot share the
Keychain with the app, and there is no push.

The workflow selects Xcode with `maxim-lobanov/setup-xcode`: the newest
stable one, or the repository variable `XCODE_VERSION`. The iOS 27 SDK needs
the UIScene life cycle, and `plugins/with-ios-scene.js` adds it. The plugin
does not depend on the Xcode version.
