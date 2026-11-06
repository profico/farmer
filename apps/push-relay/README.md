# Push relay (`@farmer/push-relay`)

The push relay sends a push from any farmer server to a phone. It runs at
`push.farmer.profi.co`, and it holds Profico's APNs key and FCM credentials.
The relay forwards an encrypted payload and cannot read it. See
`docs/adr/0006-push-relay.md`.

The relay is a `Bun.serve()` process with one `bun:sqlite` file. It does not
import `@farmer/core` or `apps/web`, and `oxlint.config.ts` stops an import of
them.

## Run it

```sh
bun run dev            # from apps/push-relay: watch mode, port 3000
bun test               # the tests, with no network
bun run build          # dist/relay.js, one file
```

With no credentials, the relay runs in dry-run mode. It logs one line for each
push and answers `202`. Thus you can run it before the Apple and Google
accounts exist.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | The HTTP port. |
| `RELAY_DB_PATH` | `./data/relay.sqlite` | The SQLite file. The relay makes the directory on start. The image sets `/data/relay.sqlite` on the `/data` volume. |
| `TRUSTED_IP_HEADER` | (required in production) | The one header that the proxy in front of the relay sets with the client address. When `NODE_ENV=production` (the Docker image sets it), the relay refuses to start if this is unset or empty. Set `none` for a relay with no proxy in front: the relay then uses the socket address only and trusts no header. Behind Cloudflare, set `cf-connecting-ip`. With a proxy and `none`, every caller shares the proxy's bucket. For `x-forwarded-for` the relay reads the last entry. An IPv6 address counts as its /64 prefix for the rate limits. The origin must accept traffic only through the proxy that sets this header: else a caller sets the header and picks its own rate-limit bucket. The proxy must set this header on every request and must remove any value from the caller. The relay refuses to start if the value is not a header name. The relay logs the choice at start, and logs one warning when a request has no such header. |
| `RELAY_MAX_DEVICES` | `100000` | The most devices that the relay holds. A registration past it gets `503 relay_full`. |
| `REQUIRE_SERVER_KEY` | `false` | `true`: a push with no server key gets `401 server_key_required`. `false`: a push with no key still works and counts in the `anonymous` bucket, with no limit. A push with a bad key is refused in both cases. See "Server keys". |
| `APNS_KEY_P8` | (none) | The `.p8` key from Apple, as PEM. Literal `\n` sequences count as line breaks. |
| `APNS_KEY_ID` | (none) | The key id of the `.p8` key. |
| `APNS_TEAM_ID` | (none) | The Apple team id. |
| `APNS_TOPIC` | `com.profico.farmer` | The bundle id of the app. Live Activity pushes use `<topic>.push-type.liveactivity`. |
| `FCM_SERVICE_ACCOUNT_JSON` | (none) | The full JSON key file of a Google service account that can send FCM messages. |

Set all three of `APNS_KEY_P8`, `APNS_KEY_ID` and `APNS_TEAM_ID`, or none of
them. A half-set APNs configuration, a key that does not import, or
service-account JSON that does not parse stops the start. A platform with no
credentials is a dry run.

The relay never logs a ciphertext, a push token, a device secret or a full
relay id. A log line holds only the first six characters of a relay id.

## API

All bodies are JSON. The relay refuses a body over 8 KB with `413`. An error
answer is `{ "error": "<code>" }`.

### `POST /v1/devices`

The app registers one installation.

```json
{
  "platform": "ios",
  "pushToken": "<APNs device token or FCM registration token>",
  "apnsEnvironment": "production",
  "liveActivityPushToStartToken": "<optional, iOS only>"
}
```

`apnsEnvironment` is `production` or `sandbox`, and the default is
`production`. Android ignores the two iOS fields.

The answer is `201` with `{ "relayId", "deviceSecret" }`. Both are random
base64url values: 128 bits for the relay id, 256 bits for the secret. The
relay keeps only the SHA-256 hash of the secret. The app keeps the secret and
gives only the relay id (and its public key) to its server.

### `PUT /v1/devices`

The app sends a new token, with `Authorization: Bearer <deviceSecret>` and
`X-Relay-Id: <relayId>`. The relay id is in a header and not in the URL path,
because a proxy writes the path in its access log. Send
one or more of `pushToken`, `apnsEnvironment` and
`liveActivityPushToStartToken` and `liveActivityToken`. A `null` push-to-start
token clears it. `liveActivityToken` binds a per-activity token to the
device (iOS only, hex). A `null` `liveActivityToken` unbinds all of them. See
"Live Activity tokens".

The answer is `200`. A missing or wrong secret and an unknown relay id all
get the same `401 unauthorized`. A `liveActivityToken` that another device
holds gets `409 activity_token_bound_elsewhere`, and the update changes
nothing.

### Live Activity tokens

A Live Activity token tells APNs which activity to change. The relay binds
each token to the device registration that proved ownership with its device
secret:

- The push-to-start token is one column of the device row. Only the holder
  of the secret sets it.
- A per-activity token goes in a table with the relay id of its device. The
  token is unique, so a second device cannot take it. A device keeps at most
  four, and the oldest go first.
- The relay removes the tokens of a device when it removes the device: a
  `DELETE`, a `410`, or the 180-day expiry. A new `apnsEnvironment` removes
  them too, because a token is valid in one environment only.
- The relay removes a token on `activity_gone` and after a delivered `end`.
- A push that carries a token bound to another device gets
  `403 activity_token_mismatch`. The relay sends nothing.
- A push sends only to the tokens of its own `relayId`: the device token, the
  push-to-start token of that device, or a per-activity token that the
  device owns.

- A push that carries a token that no device holds gets
  `403 activity_token_unbound`. The relay sends nothing. The app binds
  each new activity token with `liveActivityToken` before the server uses it.

### `DELETE /v1/devices`

The app forgets the device, with the same `Authorization` and `X-Relay-Id`
headers. The answer
is `204`, or `401`.

### `POST /v1/devices/verify`

A farmer server asks whether a phone holds a registration. The server sends
the relay id in the `X-Relay-Id` header and `{ "publicKey", "proof" }` as the
body. The app made the proof from its device secret:

    proof = base64url(HMAC-SHA256(SHA-256(deviceSecret),
            "farmer-device-binding v1\n" + relayId + "\n" + publicKey))

The relay keeps the SHA-256 of the secret, so it can compute the same HMAC.
The answer is `204` for a good proof. A wrong proof and an unknown relay id
both give `401 unauthorized`. The server never sees the device secret. The
proof names the public key, so a proof for one key cannot bind another key.
The server calls this route only when a phone takes a relay id or a key that
the server did not hold for that installation. This route has its own
limits (see "Rate limits").

### `POST /v1/push`

A farmer server sends a push, with `Authorization: Bearer <server key>`. The
key says which server sends (see "Server keys"). The relay id says which
phone gets the push. The relay id is the credential for the phone (ADR 0006).

The relay makes the relay id from 128 random bits (`src/ids.ts`). Only three
parties hold it: the phone, the farmer server of the phone, and the relay. A
holder of the relay id can do these things:

- Send a push to the phone. This includes a Live Activity state, which is not
  encrypted, so the phone shows it.
- Use the push budget of the phone (see "Rate limits"). The pushes of the
  real server then get `429`.

Thus keep the relay id secret, as a token. The relay logs only the first six
characters of it. The farmer server does not send it in an API answer, an
audit entry or a webhook event, and its push log lines do not show it. A
second shared secret does not give more protection, because each party that
holds the relay id would hold that secret too.

```json
{
  "relayId": "<relay id>",
  "kind": "alert",
  "ciphertext": "<base64url, at most 3072 characters>",
  "liveActivity": {
    "token": "<per-activity token; absent means push-to-start>",
    "event": "update",
    "contentState": { "startedAtMs": 1790000000000, "paused": false },
    "staleDate": 1790003600,
    "dismissalDate": 1790007200,
    "attributesType": "TimerAttributes",
    "attributes": { "version": 1 }
  }
}
```

- `kind` is `alert`, `data` or `liveactivity`. `liveActivity` is necessary
  for `liveactivity` and is refused for the other kinds.
- `contentState` and `attributes` hold primitive values only (string, number,
  boolean, null). `contentState` is at most 1 KB as JSON.
- `contentState` and `attributes` are **not** encrypted, because iOS reads
  them directly. Do not put a person's data in them (a project name, a
  description). Put text in the ciphertext.
- `contentState` never holds a Swift `Date`. ActivityKit decodes the content
  state with a default `JSONDecoder`, which reads a `Date` as seconds since
  2001-01-01, not since 1970. A timestamp in `contentState` is a plain number
  of Unix-epoch **milliseconds**, and the widget converts it.
- `staleDate` and `dismissalDate` are Unix **seconds**. They go into the APNs
  `aps` dictionary, not into the content state, and APNs reads them.
- A push without `liveActivity.token` is a push-to-start. It must be a
  `start` event with `attributesType` and `attributes`, and the relay uses the
  device's push-to-start token.

| Status | Body | Meaning | What the server does |
|---|---|---|---|
| `200` | `{ "status": "delivered" }` | APNs or FCM took the push. | Nothing. |
| `202` | `{ "status": "dry_run" }` | No credentials for the platform. | Nothing. |
| `400` | `invalid_body`, `invalid_json` | The body is wrong. | Fix the request. |
| `401` | `server_key_required`, `invalid_server_key` | No key (with `REQUIRE_SERVER_KEY` on), or a key that the relay does not know. | Do not retry. Log it once. Set `PUSH_RELAY_KEY`. |
| `403` | `server_key_revoked` | The operator revoked the key. | Do not retry. Log it once. |
| `429` | `monthly_quota_exceeded` with `limit` and `resetsAt` | The key sent its monthly limit. `Retry-After` gives the seconds to the next UTC month. | Do not retry. Log it once. Drop the push. |
| `404` | `unknown_relay_id` | The relay does not know the id. | Delete the `mobile_device` row. |
| `409` | `activity_gone` | The per-activity token is dead: the Live Activity ended. | Forget the activity token. Keep the row. |
| `403` | `activity_token_mismatch`, `activity_token_unbound` | The per-activity token belongs to another device, or no device holds it. | Do not retry. Keep the row. |
| `409` | `start_token_gone` | The push-to-start token is dead. The relay cleared it. | Keep the row. |
| `409` | `no_start_token` | A push-to-start, but the device gave no push-to-start token. | Keep the row. |
| `410` | `device_gone` | APNs or FCM says that the device token is dead. The relay deleted the device. | Delete the `mobile_device` row. |
| `413` | `too_large` | The body is over 8 KB, or the built payload is over 4 KB. | Send less. |
| `429` | `rate_limited` | A rate limit. `Retry-After` gives the seconds. | Try again later, or drop the push. |
| `502` | `upstream_failed` with `upstreamStatus` and `reason` | Any other APNs or FCM refusal. | Log it. Keep the row. |
| `502` | `upstream_unreachable` | The relay could not reach APNs or FCM. | Try again later. |

### Server keys

Each farmer server that sends push through Profico's relay needs a server key.
The operator of the relay mints it. The model is the same as for Rocket.Chat
and Bitwarden: a self-hosted server is registered with the publisher.

A key is `<id>.<secret>`. The secret is 256 random bits. The relay keeps only
the id, the SHA-256 hash of the secret, a label, a contact, the monthly limit,
the time of creation and the time of revocation. It compares the hash in
constant time. The key is shown once, when it is made.

The commands open the same SQLite file as the relay (`RELAY_DB_PATH`). The
image holds the bundle `/app/admin.js`:

```sh
bun run admin keys create --label "Example Org" --contact person@example.com --monthly-limit 50000
bun run admin keys list                 # id, state, pushes this month, limit, label
bun run admin keys revoke <id>
bun run admin keys set-limit <id> <number>

# On the host of the image:
docker exec <container> bun /app/admin.js keys list
```

Rules:

- A push counts when it passes every check that can refuse it (the key, the
  body, the relay id, the rate limits) and before the relay sends it to APNs
  or FCM. A refused push does not use the quota. A push that APNs or FCM
  refuses does.
- The count is a row for each key and calendar month (UTC) in the SQLite
  file, so a restart keeps it. A new month starts at 0. A limit of 0 refuses
  every push.
- Over the limit, the relay answers `429 monthly_quota_exceeded`. The per-IP
  and per-device rate limits stay as they are.
- `POST /v1/devices` and `POST /v1/devices/verify` need no key. The app
  registers a device before it knows any server, and a device is not bound to
  a server key.
- With `REQUIRE_SERVER_KEY` off, a push without a key counts in the
  `anonymous` bucket. `keys list` does not show this bucket.

Rollout, in this order:

1. Deploy the relay with `REQUIRE_SERVER_KEY` unset (off).
2. Mint the key for Profico's own server.
3. Set it as `PUSH_RELAY_KEY` on the Profico production server.
4. Deploy the server that sends the key.
5. Set `REQUIRE_SERVER_KEY=true` on the relay.

### The re-registration contract

The relay forgets a device in three cases: APNs or FCM says that its token is
dead (`410`), the app deletes it, or the relay has not seen it for 180 days.
A lost database volume has the same effect for all devices. Thus:

- On a `404` with the code `unknown_relay_id`, or a `410` with the code
  `device_gone`, from `POST /v1/push`, the server deletes its
  `mobile_device` row. A `404` or a `410` without that code (for example,
  from a proxy during a redeploy) is a failure, and the row stays.
- When the app comes to the foreground, it checks its registration with its
  server. If the server has no row for it, or the relay answers `401` to a
  `PUT`, the app registers again (`POST /v1/devices`) and gives the new relay
  id and its public key to its server.

### Device expiry

Each device has a `last_seen_at` time. Registration, a token update (`PUT`)
and each accepted push (`200` or `202`) set it to now. A refused push does
not. The relay deletes each device unseen for 180 days, one time at start and
then one time each day, in the same process.

### `GET /healthz`

`200 ok` when the database answers a query, else `503`.

## Rate limits

The limits are fixed windows in memory. A restart clears them. Each map keeps
at most 50,000 keys.

| Limit | Value |
|---|---|
| Alert and data pushes for one relay id | 30 a minute, 500 a day |
| Live Activity pushes for one relay id | 60 a minute, 2,000 a day |
| Pushes from one address | 6,000 a minute |
| Alert and data pushes for one push token (all relay ids that hold it, except the oldest) | 30 a minute, 500 a day |
| Live Activity pushes for one push token (same rule) | 60 a minute, 2,000 a day |
| Registrations, and updates or removals with a wrong secret, from one address | 60 in 10 minutes |
| Updates and removals with the right secret, for one relay id from one address | 120 in 10 minutes |
| Verify calls from one address | 6,000 a minute |
| Verify calls for one known relay id from one address | 10 in 10 minutes |
| Verify calls for an unknown relay id from one address | 60 in 10 minutes |

The relay checks a relay id before it counts a verify call. A known id has a
limit for each address, so one caller cannot use up the limit of the real
server. An unknown id counts against the address only.

The relay holds at most `RELAY_MAX_DEVICES` devices. When the relay is full,
it first deletes the oldest devices that have no proof, whatever their age
(first in, first out), and logs a warning. It deletes only as many as
the new registration needs. It never deletes a device with a proof. Only a
delivered push is a proof. A
registration, a verify call and a token update are not, because the
registrant holds the device secret and can make them for junk rows. A real
phone that never got a push can be pruned, but only when the relay is full.
That phone registers again on its next
launch: its `PUT` gets `401` and the app registers (`registration.ts` in
`apps/mobile/src/push`). If the relay is still
full, a registration gets `503 relay_full` with `Retry-After`, and the relay
logs one line. A phone that the prune removed registers again when its relay
id is unknown.

A caller can mint relay ids, so the push token limits and this cap bound the
abuse. The oldest binding of a push token (the time when a device got the token, not the time of its first registration) counts only against its own
relay id limit. The younger registrations of the same token share the token
limit. A caller who knows a victim's push token can thus use up the token
limit, but not the limit of the victim's own registration.

The address limit for pushes is high on purpose. One farmer server is one
address for all of its users, and a reminder goes to many users at the same
minute. The limits for each relay id stop abuse of one device.

## Delivery

### iOS (APNs)

The relay signs an ES256 provider token with the `.p8` key and uses it for 50
minutes. All pushes of the process share it, because APNs refuses new tokens
more often than every 20 minutes (`TooManyProviderTokenUpdates`). On
`ExpiredProviderToken` the relay signs a new token and tries one more time.

| Kind | `apns-push-type` | Priority | Payload |
|---|---|---|---|
| `alert` | `alert` | 10 | `{ aps: { alert: { title: "Farmer", body: "New notification" }, "mutable-content": 1 }, e }` |
| `data` | `background` | 5 | `{ aps: { "content-available": 1 }, e }` |
| `liveactivity` | `liveactivity` | 5 for `update`, 10 for `start` and `end` | `{ aps: { timestamp, event, "content-state", "stale-date"?, "dismissal-date"?, "attributes-type"?, attributes?, alert? }, e }` |

`e` is the ciphertext. The Notification Service Extension of the app opens
`e` and replaces the placeholder text of an alert. A push-to-start also has a
fixed alert (`Farmer`, `Timer running`), because APNs requires one.

The relay sends to `api.push.apple.com` or `api.sandbox.push.apple.com`, as
the device's `apnsEnvironment` tells. An `update` has priority 5,
because priority 10 spends the budget that Apple gives each app for Live
Activity updates. A `410` or `BadDeviceToken` on the device token deletes the device. The same answer on a Live Activity token does not: the relay drops only that token. A real app that sent a sandbox token to production registers again.

**HTTP/2 under Bun.** APNs speaks HTTP/2 only. Bun 1.4.2's `fetch` speaks
HTTP/1.1 to it and fails with `Malformed_HTTP_Response`. Thus the relay uses
`node:http2`, which Bun supports. A check from Bun 1.4.2 against the sandbox
host got a real `403 InvalidProviderToken` back through `node:http2`. No push
with a real key has gone through yet. The relay keeps one session for each
host and drops it on `error`, `goaway` or `close`. Each request has a timeout
of 10 seconds. A request that times out cancels only its own stream. The
relay then sends a PING, and it destroys the session only if the PING has no
answer. Under Bun, `setTimeout` on a stream or a session fires at about twice
its value, so the relay uses a plain timer. `Bun.serve` has `idleTimeout: 60`.

### Android (FCM)

The relay exchanges a signed RS256 JWT for an OAuth 2.0 access token and
keeps the token until one minute before it ends. It sends an FCM HTTP v1
message with `android.priority: HIGH` and a data map only, with no
`notification` block, so the app opens the payload and shows the
notification itself. FCM accepts only string values in the data map:

| Key | Value |
|---|---|
| `e` | The ciphertext. |
| `k` | The kind. |
| `la_event` | The Live Activity event. |
| `la_content_state` | The content state, as one JSON string. |
| `la_stale_date`, `la_dismissal_date` | Unix seconds, as strings. |
| `la_attributes_type` | The attributes type. |
| `la_attributes` | The attributes, as one JSON string. |

`UNREGISTERED` and `INVALID_ARGUMENT` delete the device. The relay checks the
shape and the size of each message, so `INVALID_ARGUMENT` means that the token
is not a registration token. A junk token does not stay in the store.

## The encryption contract

The relay does not decrypt. The farmer server encrypts each payload for one
device with `@farmer/push-crypto` (`packages/push-crypto`), and the app opens
it.

- **Suite:** HPKE base mode (RFC 9180) with DHKEM(P-256, HKDF-SHA256),
  HKDF-SHA256 and AES-256-GCM. On iOS this is CryptoKit's
  `HPKE.Ciphersuite.P256_SHA256_AES_GCM_256`. Android and JavaScript can use
  WebCrypto. The package uses `@hpke/core`, which runs on Bun's WebCrypto.
- **Device key:** the app makes a P-256 key pair and keeps the private key in
  the Keychain or the Keystore. It gives its server the public key as the
  65-byte uncompressed point (`0x04 || x || y`). On iOS this is
  `x963Representation`. `sealForDevice` also accepts the 64-byte
  `rawRepresentation`.
- **Sealed value:** `base64url(enc || ct)`, no padding. `enc` is 65 bytes. `ct`
  ends with the 16-byte GCM tag.
- **Info:** `PUSH_INFO`, `"farmer push v1"`. A new plaintext format gets a new
  value. A new field that an old app can ignore does not.
- **Freshness:** the server adds `pushKind`, `sentAt` and `id` to each
  plaintext (`@farmer/push-crypto/freshness`). The device refuses a payload in
  a push of another kind, an old one, and one that it saw already. The relay
  cannot read these fields, and cannot change them.

```ts
import { PUSH_INFO, sealForDevice } from "@farmer/push-crypto";

const ciphertext = await sealForDevice(
	devicePublicKey, // Uint8Array, 65 bytes
	new TextEncoder().encode(JSON.stringify(payload)),
	PUSH_INFO,
);
// POST /v1/push { relayId, kind: "alert", ciphertext }
```

`openOnDevice(privateKey, sealed, PUSH_INFO)` is the reverse. It throws on a
changed byte, a different key or a different info value.

The ciphertext can be at most 3,072 base64url characters, which is about
2,200 bytes of plaintext. With a Live Activity, the full APNs payload must
also stay under 4 KB.

## Deployment

`apps/push-relay/Dockerfile` builds the image from the repo root:

```sh
docker build -f apps/push-relay/Dockerfile -t farmer-push-relay .
```

The image holds one bundled file and no `node_modules`. It runs as the `bun`
user, keeps the database on the `/data` volume, and checks `/healthz`. CI
pushes `ghcr.io/<owner>/farmer-push-relay:latest` on a push to `main`
(`.github/workflows/ci.yml`, job `push-relay-image`). On Coolify, the relay is
a "Docker Image" resource with a persistent volume on `/data`. The device
table, the server keys and the monthly counts all live in that one file. Lose
the volume and you lose the keys: keep a backup of `/data/relay.sqlite`.
