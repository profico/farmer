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
| `TRUSTED_IP_HEADER` | `cf-connecting-ip` | The one header that the proxy in front of the relay sets with the client address. For `x-forwarded-for` the relay reads the last entry. `none` means the socket address only: behind a proxy, every caller then shares the proxy's bucket, so do not set `none` there. An IPv6 address counts as its /64 prefix for the rate limits. The origin must accept traffic only through the proxy that sets this header: else a caller sets the header and picks its own rate-limit bucket. The proxy must set this header on every request and must remove any value from the caller. |
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

### `PUT /v1/devices/:relayId`

The app sends a new token, with `Authorization: Bearer <deviceSecret>`. Send
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

### `DELETE /v1/devices/:relayId`

The app forgets the device, with the same `Authorization` header. The answer
is `204`, or `401`.

### `POST /v1/devices/:relayId/verify`

A farmer server asks whether a phone holds a registration. The server sends
`{ "publicKey", "proof" }`. The app made the proof from its device secret:

    proof = base64url(HMAC-SHA256(SHA-256(deviceSecret),
            "farmer-device-binding v1\n" + relayId + "\n" + publicKey))

The relay keeps the SHA-256 of the secret, so it can compute the same HMAC.
The answer is `204` for a good proof. A wrong proof and an unknown relay id
both give `401 unauthorized`. The server never sees the device secret. The
proof names the public key, so a proof for one key cannot bind another key.
The server calls this route only when a phone takes a relay id or a key that
the server did not hold for that installation. This route counts in the
limit of registrations, updates and removals for one address.

### `POST /v1/push`

A farmer server sends a push. There is no authentication: only the device's
own server knows the relay id (ADR 0006).

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
| Registrations, updates and removals from one address | 60 in 10 minutes |

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
Activity updates. A `410` on the device token deletes the device. A `410` (or `BadDeviceToken`) on a Live Activity token does not.

**HTTP/2 under Bun.** APNs speaks HTTP/2 only. Bun 1.4.2's `fetch` speaks
HTTP/1.1 to it and fails with `Malformed_HTTP_Response`. Thus the relay uses
`node:http2`, which Bun supports. A check from Bun 1.4.2 against the sandbox
host got a real `403 InvalidProviderToken` back through `node:http2`. No push
with a real key has gone through yet. The relay keeps one session for each
host and drops it on `error`, `goaway` or `close`. Each request has a timeout
of 10 seconds.

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

Only `UNREGISTERED` deletes the device. `INVALID_ARGUMENT` usually means a
fault in the message, so the device stays.

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
a "Docker Image" resource with a persistent volume on `/data`.
