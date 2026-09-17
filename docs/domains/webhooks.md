# Outbound webhooks

An organization sends its own events to a URL it owns. Outbound only — nothing
here accepts an inbound call. Issue #67 asked for it so that an integration
nobody has built yet does not have to be built by us.

The model is Stripe's, because a receiver has probably written one already:
one endpoint per URL, a signed POST per event, a delivery log, and a Resend
button. Where this differs from Stripe, it is said below and there is a reason.

## The pieces

| File | What it is |
|---|---|
| `packages/core/src/db/schema/webhooks.ts` | `webhook_endpoint`, `webhook_event` (the outbox), `webhook_delivery` (one row per attempt, and the queue) |
| `packages/core/src/api/webhooks.ts` | The payload contract: the kinds, what each carries, the envelope, the header names. Types and constants only |
| `packages/core/src/services/events.ts` | **The emit seam.** `emitEvent(ctx, kind, build)` — the outbound sibling of `notify.ts` |
| `packages/core/src/services/webhooks.service.ts` | Admin-only CRUD, the secret roll, the test event, the delivery log, Resend |
| `packages/core/src/lib/webhook-signature.ts` | `Farmer-Signature`, and the reference verifier the tests check the signer against |
| `packages/core/src/lib/webhook-url.ts` | **The SSRF guard.** Read this one before changing anything about URLs |
| `packages/core/src/jobs/webhook-delivery.ts` | Fan out, claim, send, retry, give up, sweep |
| `apps/web/src/routes/$orgSlug/settings/webhooks/` | The endpoint list and one endpoint's page |

## The rule that holds it up

**Nothing on a request path calls out.** A service writes one `webhook_event`
row inside its own transaction and returns; the job does the rest on its own
clock. A time entry and the record that it happened commit or roll back
together, and nobody's browser waits on somebody else's server.

`emitEvent` takes a **function**, not a payload:

```ts
await emitEvent(txCtx, "time_entry.created", () =>
  timeEntryWebhookPayload(txCtx, createdId),
);
```

Almost no organization has an endpoint, and every one of them writes time
entries all day. A payload is a projection over three joins plus the person's
name, so building it eagerly would put a query on the hot path of every write in
the product in exchange for a row that is deleted unread. `webhookWants` answers
from a 60-second cache, so the common case is a Map lookup and a return.

That cache is why a new endpoint can take up to a minute to start receiving.
`invalidateWebhookSubscriptions` makes it instant within one process; the web
host and the worker are two processes, so the TTL is the real bound.

## What is sent, and what is not

Twelve kinds (`WEBHOOK_EVENT_KINDS`): `time_entry.created` / `.updated` /
`.deleted`, `absence.created` / `.removed`, `project.created` / `.updated`,
`client.created`, `member.added`, `member.archived`, `import.finished`, and
`webhook.test`.

**One event per row**, including a copied week — about forty events (issue #67,
question 1). A batch shape would mean a second payload for every kind, and a
receiver reconciles entries one at a time anyway.

**The automation engines emit nothing.** Fill blocks, synced meetings,
materialized recurring blocks and the commit/PR work blocks reconcile rather
than append — a sweep rewrites a block every twenty minutes as the day fills up
— so a row there is not "something happened", it is "the same thing,
recalculated". A receiver that sees a person's typed entries and not their
synced meetings is seeing the rule, not a bug.

**The Harvest import is silent for the same reason** and sends
`import.finished` with the counts instead. An import writes tens of thousands of
entries at once; a receiver wants to know it happened and then re-read.

A time entry's events are split by whether its task is an absence:
`absence.created` / `absence.removed` for time off, `time_entry.*` for work.
Somebody being away is a different fact from somebody working, and a receiver
that syncs holidays wants one and not the other. An **edit** is always
`time_entry.updated`, absence included — there is no `absence.updated`.

## The envelope

```json
{
  "id": "9f2c…",
  "version": "2026-09-17",
  "kind": "time_entry.created",
  "createdAt": "2026-09-17T08:31:02.000Z",
  "organization": { "id": "…", "slug": "acme", "name": "Acme" },
  "data": { "entry": { … }, "member": { … } }
}
```

Headers: `Farmer-Signature`, `Farmer-Event` (the event id, same as `id`),
`Farmer-Delivery` (unique per attempt), `Farmer-Webhook-Id`, `Farmer-Attempt`.

**Order is not guaranteed and never will be.** Guaranteeing it costs a queue per
organization in which every event waits behind a dead endpoint's retries. Use
`id` to drop a duplicate and `createdAt` to decide which of two events about one
entry is the later (issue #67, question 2).

**One payload version for the whole deployment** (`WEBHOOK_PAYLOAD_VERSION`),
not one per endpoint. Stripe pins a version per endpoint; that is worth its
machinery when there is a second version to pin, and not before. When that day
comes the column goes on `webhook_endpoint` and the constant becomes its default
(issue #67, question 8).

## The signature

```
Farmer-Signature: t=1758096662,v1=<hex>[,v1=<hex>]
```

Each `v1` is `HMAC-SHA256("<t>.<raw body>", secret)`, hex. A receiver should:

1. Read the body as **text**, before parsing it. Parsing and re-encoding changes
   the bytes on the first payload whose key order or unicode escaping differs.
2. Recompute the HMAC over `"<t>.<body>"` and compare in **constant time**.
3. Refuse a `t` more than five minutes from its own clock
   (`WEBHOOK_SIGNATURE_TOLERANCE_SECONDS`). The timestamp is inside the signed
   string precisely so that an old capture cannot be replayed.
4. Accept if **any** `v1` matches. There are two during the 24 hours after a
   roll.

`verifyWebhookSignature` in `lib/webhook-signature.ts` is that verifier,
written out so the tests check the signer against it rather than against itself.

**The secret is written to the database and never returned** — the rule the
Slack bot token and the OpenRouter key follow (issue #67, question 6). It is
revealed once at creation and once per roll, and the page shows the last four
characters afterwards. It is stored as it is sent rather than hashed, because it
is not a credential this app verifies: it is the key it signs with.

## The address guard

**This is the part to get right.** The URL comes from an admin's browser and the
call is made by the process that holds the database credentials, the object
store keys and — on any managed host — a metadata endpoint that hands out cloud
credentials to whoever asks from inside.

`lib/webhook-url.ts` enforces four rules:

1. **HTTPS only.** A plain-HTTP webhook puts somebody's timesheet notes on the
   wire in the clear. The signature proves who sent it; it hides nothing.
2. **No credentials in the URL.**
3. **No non-public address**, literal or resolved: loopback, private, CGNAT,
   link-local (`169.254.169.254`), multicast, reserved, and the IPv6 forms of
   all of them — including `::ffff:127.0.0.1`, `64:ff9b::10.0.0.1` and 6to4,
   which are private addresses wearing IPv6 syntax and walk through any guard
   that only matches the prefix.
4. **Re-checked before every attempt, and no redirect followed.** A name that
   resolved publicly an hour ago can resolve to 127.0.0.1 now (DNS rebinding),
   which is also why **a 3xx counts as a failed delivery**.

One gap, stated because it is real: between the lookup and the connection
`fetch` makes, the runtime resolves the name a second time, and a resolver that
answers differently then wins. Closing it needs a custom dialer that connects to
the address this module checked; Bun's `fetch` has no such hook today. The
per-attempt re-check is the bound, not a proof.

`WEBHOOK_ALLOW_PRIVATE_HOSTS=true` switches rules 1 and 3 off, for the
self-hosted deployment whose receiver genuinely is on the same private network
(issue #67, question 9). It is the **operator's** decision and never an
organization's, which is why it is an environment variable and not a setting.

## Delivery, retries and giving up

One tick of `jobs/webhook-delivery.ts`:

1. **Fan out** — each unsent event becomes one delivery row per endpoint that
   asked for its kind. Claimed on `fanned_out_at`; the unique index on
   `(endpoint, event, attempt)` is the second lock on the same door.
2. **Claim** the due rows with an `update … returning`, which is what makes two
   processes running this job safe rather than merely unlikely.
3. **Send**, five at a time, each with its own deadline.
4. **Schedule the retry**, or give up on the endpoint.
5. **Sweep** the retention windows.

Seven attempts over about twenty-one hours: 1 minute, 5, 30, 2 hours, 6, 12
(`WEBHOOK_RETRY_DELAYS_MS`). Stripe retries for three days; this window is
shorter because the payload is deleted after three, and a schedule that outlived
what it retries would be a lie (issue #67, question 3).

**An endpoint that has not accepted a delivery for three days is switched off**
(`WEBHOOK_GIVE_UP_DAYS`) and the organization's admins are told through
`notify.ts`'s `webhook-disabled` kind, on Slack and push (issue #67, question
4). `failing_since` is the clock; a single success clears it, and turning the
endpoint back on resets it.

**Retention** (issue #67, question 3): the payload is cleared after
**3 days** and the attempt rows are deleted after **14**. The payload holds the
notes people wrote, so it goes first; a status code and a timing say nothing
about anybody. Once a payload is gone, Resend is refused rather than sending an
empty body, and the button says so.

**At most five endpoints per organization** (`MAX_WEBHOOK_ENDPOINTS`, issue #67,
question 5). Stripe allows 16 per account; a time tracker sends to a payroll
system, a dashboard and a chat bot.

## Who may do any of this

**Admin only, every function.** An endpoint receives every member's time
entries, with their notes, so registering one is a decision about the whole
organization's data — the same tier as adding a person. Enforced at
`orgAdminMiddleware` and again in the service.

The web UI is the only surface (issue #67, question 10). The CLI and the MCP
server do not read the delivery log: it is an administrative screen, not
something an agent loop or a terminal needs.

## Environment

```
WEBHOOK_DELIVERY_ENABLED=true          # "false" stops sending AND stops writing events
WEBHOOK_DELIVERY_INTERVAL_MINUTES=1
WEBHOOK_DELIVERY_TIMEOUT_MS=10000      # deadline on one POST
WEBHOOK_ALLOW_PRIVATE_HOSTS=false      # see "The address guard"
```

## Adding an event kind

1. A line in `WEBHOOK_EVENT_KINDS` and a line in `WebhookPayloadLookup`
   (`api/webhooks.ts`). The mapped type makes a missing payload a compile error.
2. A projection builder in `services/events.ts`, if the kind needs one.
3. The `emitEvent` call, inside whatever transaction already does the work.
4. A test. `services/webhooks.test.ts` shows the shape.

Nothing else: the settings page reads the kind list, and the job does not care
what a kind is.

## What is not covered by tests

The real `httpSender` — the tests substitute a sender through
`setWebhookSenderForTests`, so `externalFetch`, `redirect: "manual"` and the
bounded response read are exercised by nothing. The address rules and the
signature are tested directly and are the parts that matter; the fetch call
itself is four lines with no branches the tests could not see.
