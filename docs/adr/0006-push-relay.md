# 0006 — A push relay that cannot read the push

**Status:** Accepted
**Date:** 2026-10-06

## Context

The mobile app (ADR 0005) needs native push for three things: the log
reminder, "timer dropped", and the remote updates of the timer's Live
Activity. A timer that starts in the browser or in the CLI must also show on
the phone.

APNs and FCM accept a push only with the publisher's credentials. A Live
Activity update must go directly to APNs, signed with the publisher's `.p8`
key. Expo's push service cannot send it. A self-hosted server cannot hold
that key, because the key belongs to Profico and not to the operator.

Nextcloud has the same problem and solves it with a push proxy that the
publisher runs.

## Decision

**Profico runs a relay at `push.farmer.profi.co`, and each server uses it only
when the operator turns push on** (`PUSH_RELAY_URL`, with that address as the
default).

- **The relay is `apps/push-relay`.** It is a small `Bun.serve()` service with
  a `bun:sqlite` file on a persistent volume. It ships as its own image on
  GHCR and runs as one more resource on Coolify. It does not use the database
  of any farmer server, because it serves every server.
- **A device has a relay id and a key pair.** The app registers with the
  relay and gets an opaque `relayId`. It keeps the private key in the
  Keychain or the Keystore and gives `{relayId, publicKey}` to its server.
- **The phone proves that it holds the relay id.** The app sends its server
  a `relayProof`: an HMAC of the relay id and the public key, made from the
  `deviceSecret`. The server asks the relay (`POST /v1/devices/verify`)
  to check it before it binds a relay id or a key to a person. Without the
  proof, a person who learns a relay id could take it with their own key.
- **The server encrypts each payload for the device.** It posts
  `{relayId, ciphertext}`, and the relay forwards the push to APNs or FCM. The
  relay never reads the content, and a server never learns the real push
  token.
- **There is no account for each server.** Only the device's own server knows
  the `relayId`, and the relay applies a rate limit for each device.
- **The server stores a phone in `mobile_device`.** The table is unique on
  `(user_id, installation id)` and has **no** `organization_id`. This is the
  third deliberate exception to the tenancy rule, after `push_subscription`
  and `running_timer`. A phone belongs to a person, and the timer is one for
  each person across workspaces (ADR 0003). The row goes when the person signs
  out or when the session is revoked.
- **Native push is a channel in `services/notify.ts`**, beside web push and
  Slack. It carries the log reminder, "timer dropped" and the Live Activity
  start, update and end.
- **The app takes the Slack kinds from Slack.** A person who has a device
  with notifications allowed gets the compliance nudge, the month-end
  reminder and the admin digest as a push. A preference sends them back to
  Slack. When every push to a person fails, that message falls back to Slack.

## Consequences

- If the relay is down, a notification is lost, but no data is lost. The Live
  Activity still counts locally, and the app reads the timer again in the
  foreground.
- An operator who does not want a third party in the path leaves push off.
  The app still works, but without remote push. `docs/domains/deployment.md`
  must say this.
- The relay holds the APNs key and the FCM credentials. These are Profico's
  secrets and live only in the relay's Coolify environment.
- The relay's rate limits trust the one header that `TRUSTED_IP_HEADER`
  names. With the value `none`, the relay trusts no header and uses the
  socket address. In production the relay refuses to start when the variable
  is unset, because all phones would then share the proxy's address and one
  bucket. The relay's origin must accept traffic only through the proxy that
  sets this header. Else a caller sets the header and picks its own bucket.
  An IPv6 caller gets its /64 prefix as its bucket.
- A reminder can arrive twice. If the relay times out after it delivered the
  push, the server cannot know, so the Slack reminder job tries again. The
  duplicate is accepted: a lost reminder is worse than a repeated one.
  `native-push.test.ts` pins this.
- The reminder job also runs for a workspace with no Slack installation when
  a person there has a phone that allows notifications. It then sends through
  the app only and never tries Slack.
- A new kind of notification must name its channels in the `KINDS` table, as
  before. Native push is one more channel, not a second mechanism.

## Accepted risk: the binding proof

The binding proof is an HMAC. Its key is `sha256(deviceSecret)`. This is
the same value as the `secretHash` that the relay stores for the device.
A person who can read the relay's device table can therefore forge a
binding proof for any relay id.

A proof is not bound to a user, and it does not expire. A person who
captures a proof can replay it from another account. Only a leak of a
server log or a compromised server exposes a proof.

We accept both risks. The design is symmetric on purpose: the relay
checks the proof with a value that it already holds, and the Farmer
server never holds the device secret. A design that keeps the secret off
the Farmer server needs this shared key. A read of the relay's database
is already a more serious loss, because the same read exposes every push
token.
