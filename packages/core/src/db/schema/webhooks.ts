// Outbound webhooks: what this organization sends to somebody else's server.
//
// Three tables, and the split is the whole design (issue #67):
//
//   * `webhook_endpoint` — a URL an admin registered, with the event kinds it
//     asked for and the secret its receiver verifies with.
//   * `webhook_event` — the OUTBOX. A service writes one row inside its own
//     transaction and returns; nothing calls `fetch` on a request path. An
//     event belongs to the organization, not to an endpoint, so one row feeds
//     every endpoint that asked for its kind.
//   * `webhook_delivery` — one row per ATTEMPT. The row is also the queue: a
//     row with `attempted_at` still null and `next_attempt_at` in the past is
//     work the delivery job claims. A failed attempt that has retries left
//     inserts the next row rather than editing itself, so the log is a history
//     and not a counter.
//
// Retention is decided here and swept by the job: the payload is cleared after
// `WEBHOOK_PAYLOAD_RETENTION_DAYS` (3) because it holds the notes people
// wrote, and the attempt rows are deleted after
// `WEBHOOK_LOG_RETENTION_DAYS` (14) because by then they answer nothing.

import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	smallint,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

import type { WebhookEventData } from "../../api/webhooks";
import { organization, user } from "./auth";

const ts = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" });
const org = () =>
	text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" });
const stamps = {
	createdAt: ts("created_at").notNull().defaultNow(),
	updatedAt: ts("updated_at").notNull().defaultNow(),
};

// One endpoint per URL per organization: registering the same URL twice would
// double every delivery to it, and a receiver that dedupes on the event id
// cannot tell the two apart.
//
// The secret is stored as it is sent, not hashed, and that is deliberate: it is
// not a credential this app verifies, it is the key it SIGNS with, so it has to
// be readable at delivery time. It follows the rule of the Slack bot token and
// the OpenRouter key — written to the database, never returned to the browser
// after the one reveal (see `webhooks.service.ts`).
//
// `previous_secret` is the roll. Both secrets sign every payload for the 24
// hours after a roll (two `v1=` values in one header, as Stripe does), so a
// receiver can be redeployed with the new secret at its own pace instead of
// dropping everything in between.
export const webhookEndpoint = pgTable(
	"webhook_endpoint",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		url: text("url").notNull(),
		description: text("description"),
		secret: text("secret").notNull(),
		previousSecret: text("previous_secret"),
		previousSecretExpiresAt: ts("previous_secret_expires_at"),
		/** The kinds this endpoint asked for, as `api/webhooks.ts` names them. An
		 *  empty array would be an endpoint that receives nothing, so the Zod input
		 *  and the check below both refuse it. */
		enabledEvents: text("enabled_events").array().notNull(),
		/** Set when an admin switched it off, or when the job gave up on it. Null
		 *  is the only state that receives anything. */
		disabledAt: ts("disabled_at"),
		disabledReason: text("disabled_reason"),
		/** The last attempt that answered 2xx, and the start of the run of
		 *  failures that has not been broken by one. `failing_since` is what the
		 *  give-up rule reads; a success clears it. */
		lastSuccessAt: ts("last_success_at"),
		failingSince: ts("failing_since"),
		/** Who registered it. `set null` rather than cascade — the endpoint is the
		 *  organization's, and it must not stop sending because a person left. */
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		...stamps,
	},
	(t) => [
		unique("webhook_endpoint_org_url_unq").on(t.organizationId, t.url),
		index("webhook_endpoint_org_idx").on(t.organizationId),
		check(
			"webhook_endpoint_events_not_empty",
			sql`array_length(${t.enabledEvents}, 1) >= 1`,
		),
	],
);

// The outbox. One row per thing that happened, written by `services/events.ts`
// in the transaction of whatever caused it.
//
// `endpoint_id` is null for every real event — an event is the organization's
// and fans out to every endpoint subscribed to its kind. It is set only by
// "Send test event", which is a message to ONE endpoint and would otherwise
// arrive at all of them.
//
// `data` holds the projection the receiver gets (`api/webhooks.ts`), never a
// row. `data_dropped_at` is the retention sweep's mark: the event stays, so the
// log still says what was sent and when, but the notes are gone and a Resend is
// refused rather than sending an empty body.
export const webhookEvent = pgTable(
	"webhook_event",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		kind: text("kind").notNull(),
		endpointId: uuid("endpoint_id").references(() => webhookEndpoint.id, {
			onDelete: "cascade",
		}),
		data: jsonb("data").$type<WebhookEventData>(),
		dataDroppedAt: ts("data_dropped_at"),
		occurredAt: ts("occurred_at").notNull().defaultNow(),
		/** When the job turned this event into delivery rows. Null means it has not
		 *  been looked at yet; the fan-out pass claims on exactly this column, so a
		 *  repeated tick cannot send an event twice. */
		fannedOutAt: ts("fanned_out_at"),
		createdAt: ts("created_at").notNull().defaultNow(),
	},
	(t) => [
		// The fan-out pass's only query: the unfanned rows, oldest first. Partial,
		// because every row leaves this set within a tick and a full index would be
		// almost entirely dead weight.
		index("webhook_event_pending_idx")
			.on(t.occurredAt)
			.where(sql`${t.fannedOutAt} is null`),
		index("webhook_event_org_idx").on(t.organizationId, t.occurredAt),
	],
);

// One row per attempt, and the queue at the same time.
//
// A row is born due (`next_attempt_at`, `attempted_at` null), claimed by the
// job (`claimed_at`), then stamped with what happened. A failure with retries
// left inserts attempt N+1; a failure without them leaves the row as the last
// word. `id` is what goes out as `Farmer-Delivery`, so a receiver that logs the
// header can be asked about one exact attempt.
export const webhookDelivery = pgTable(
	"webhook_delivery",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		endpointId: uuid("endpoint_id")
			.notNull()
			.references(() => webhookEndpoint.id, { onDelete: "cascade" }),
		eventId: uuid("event_id")
			.notNull()
			.references(() => webhookEvent.id, { onDelete: "cascade" }),
		/** 1 for the first try. A Resend continues the numbering rather than
		 *  starting over — it is the Nth time this event went to this endpoint,
		 *  whoever asked for it — and sets `manual`, so a person's button and the
		 *  automatic schedule are told apart in the log. */
		attempt: smallint("attempt").notNull().default(1),
		manual: boolean("manual").notNull().default(false),
		nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
		claimedAt: ts("claimed_at"),
		attemptedAt: ts("attempted_at"),
		/** The HTTP status, null when the request never got one (DNS, TLS, a
		 *  timeout, or a URL the address guard refused this time round). */
		statusCode: integer("status_code"),
		/** Why it failed, in the words the log shows. Null on success. */
		error: text("error"),
		/** The first bytes of the response, truncated — enough to see an error
		 *  message from the receiver without storing its whole page. */
		responseSample: text("response_sample"),
		durationMs: integer("duration_ms"),
		createdAt: ts("created_at").notNull().defaultNow(),
	},
	(t) => [
		// The claim query: due, unattempted, oldest first.
		index("webhook_delivery_due_idx")
			.on(t.nextAttemptAt)
			.where(sql`${t.attemptedAt} is null and ${t.claimedAt} is null`),
		// The endpoint's log page, newest first.
		index("webhook_delivery_endpoint_idx").on(t.endpointId, t.createdAt),
		index("webhook_delivery_event_idx").on(t.eventId),
		// One attempt number per run of an event at an endpoint. The uniqueness is
		// what makes "insert attempt N+1" safe against a doubled tick: the second
		// insert is refused by the database rather than sending twice.
		unique("webhook_delivery_attempt_unq").on(
			t.endpointId,
			t.eventId,
			t.attempt,
		),
	],
);
