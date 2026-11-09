/**
 * What an outbound webhook actually carries.
 *
 * A projection, never a row (as in `time-entries.ts`). A receiver is another
 * person's server that runs unattended, so a new or renamed column must not
 * change a field that it reads.
 *
 * The envelope is the same for every kind:
 *
 *     {
 *       "id":        "9f2c…",                  the event id — dedupe on this
 *       "version":   "2026-09-17",
 *       "kind":      "time_entry.created",
 *       "createdAt": "2026-09-17T08:31:02.000Z",
 *       "organization": { "id": "…", "slug": "acme", "name": "Acme" },
 *       "data":      { … }                     decided by `kind`
 *     }
 *
 * **Order is not guaranteed.** A guarantee needs a queue per organization,
 * where every event waits behind the retries of a dead endpoint. Use `id` to
 * drop a duplicate and `createdAt` to order two events about one entry.
 *
 * **One version for the whole deployment, not one per endpoint.** Add a
 * version column to `webhook_endpoint` when the shapes get a second version.
 * This constant then becomes its default.
 */

import type { ApiProjectRef, ApiTaskRef } from "./time-entries";

/** Long enough for any real endpoint, short enough that nothing stores a
 *  novel. Here rather than in `lib/webhook-url.ts` because the Zod input needs
 *  it and that module reaches for `node:dns`, which must never be dragged into
 *  the browser bundle by a schema import. */
export const MAX_WEBHOOK_URL_LENGTH = 2048;

/** Bumped when a field below changes meaning or leaves. Adding a field is not
 *  a bump — a receiver that reads by name does not notice one. */
export const WEBHOOK_PAYLOAD_VERSION = "2026-09-17";

/** The person an event is about. Never the whole profile: a webhook says who
 *  did something, it is not a directory export. */
export type WebhookMember = {
	id: string;
	name: string;
	email: string;
};

/** A time entry as a receiver sees it. `ApiTimeEntry` minus `commitCount`,
 *  which is a count of rows in a table that is this app's own business. */
export type WebhookTimeEntry = {
	id: string;
	/** yyyy-MM-dd, in the organization's timezone. */
	date: string;
	durationSeconds: number;
	description: string;
	overtime: boolean;
	/** A rest-of-day block: its duration follows the day, it was not typed. */
	fillsDay: boolean;
	/** Mirrors a calendar event rather than something somebody entered. */
	synced: boolean;
	task: ApiTaskRef;
	/** Null for time off, a Break, and anything not yet filed. */
	project: ApiProjectRef | null;
};

export type WebhookProject = {
	id: string;
	name: string;
	code: string | null;
	status: string;
	client: { id: string; name: string } | null;
};

export type WebhookClient = {
	id: string;
	name: string;
};

/** What a finished Harvest import created. The counts, not the rows — the rows
 *  arrive as their own events if the endpoint asked for those kinds. */
export type WebhookImportSummary = {
	id: string;
	clients: number;
	projects: number;
	people: number;
	timeEntries: number;
};

/**
 * The kinds, in the order the settings page lists them. The list is the source
 * of the union, the same shape `REMINDER_KINDS` uses in `schema/`.
 */
export const WEBHOOK_EVENT_KINDS = [
	"time_entry.created",
	"time_entry.updated",
	"time_entry.deleted",
	"absence.created",
	"absence.removed",
	"project.created",
	"project.updated",
	"client.created",
	"member.added",
	"member.archived",
	"import.finished",
	"webhook.test",
] as const;

export type WebhookEventKind = (typeof WEBHOOK_EVENT_KINDS)[number];

/**
 * What each kind's `data` holds.
 *
 * Written as a lookup and then mapped over the list above, so a kind added to
 * `WEBHOOK_EVENT_KINDS` and forgotten here fails to compile on the mapped type
 * rather than shipping as an event nobody can read. The emit call site then
 * fails too, until it passes the right shape.
 */
interface WebhookPayloadLookup {
	"time_entry.created": { entry: WebhookTimeEntry; member: WebhookMember };
	"time_entry.updated": { entry: WebhookTimeEntry; member: WebhookMember };
	"time_entry.deleted": { entry: WebhookTimeEntry; member: WebhookMember };
	"absence.created": { entry: WebhookTimeEntry; member: WebhookMember };
	"absence.removed": { entry: WebhookTimeEntry; member: WebhookMember };
	"project.created": { project: WebhookProject };
	"project.updated": { project: WebhookProject };
	"client.created": { client: WebhookClient };
	"member.added": { member: WebhookMember; role: string };
	"member.archived": { member: WebhookMember };
	"import.finished": { import: WebhookImportSummary };
	/** Sent by the "Send test event" button, to that one endpoint. It is the
	 *  only kind an endpoint cannot unsubscribe from, because refusing it would
	 *  make the button lie. */
	"webhook.test": { message: string };
}

export type WebhookEventPayloads = {
	[K in WebhookEventKind]: WebhookPayloadLookup[K];
};

/** One event's stored payload, tagged with its kind — what `webhook_event.data`
 *  holds and what the envelope's `data` is built from. */
export type WebhookEventData = {
	[K in WebhookEventKind]: { kind: K } & WebhookEventPayloads[K];
}[WebhookEventKind];

/** What arrives at the receiver, as the request body. */
export type WebhookEnvelope = {
	id: string;
	version: string;
	kind: WebhookEventKind;
	createdAt: string;
	organization: { id: string; slug: string; name: string };
	data: WebhookEventPayloads[WebhookEventKind];
};

/** The headers every delivery carries, beside `Content-Type`. */
export const WEBHOOK_HEADERS = {
	/** `t=<unix seconds>,v1=<hex>` — see `lib/webhook-signature.ts`. */
	signature: "Farmer-Signature",
	/** The event id, the same value as the body's `id`. */
	event: "Farmer-Event",
	/** This attempt's id. Unique per attempt, unlike the event id. */
	delivery: "Farmer-Delivery",
	/** Which endpoint registration this is. */
	endpoint: "Farmer-Webhook-Id",
	/** 1 for the first try. */
	attempt: "Farmer-Attempt",
} as const;
