/**
 * Sending the outbox.
 *
 * `services/events.ts` writes a `webhook_event` row and returns; this is the
 * half that talks to somebody else's server. It runs on `scheduler.ts`'s clock
 * for the reason that file gives — this deployment is one long-lived process,
 * so a job is a tick, not a queue worker — and it is idempotent at every step,
 * so a missed, repeated or overlapping tick is harmless.
 *
 * One tick, in order:
 *
 *   1. **Fan out.** Turn each unsent event into one delivery row per endpoint
 *      that asked for its kind. Claimed on `fanned_out_at`, so an event cannot
 *      be fanned out twice; the unique index on (endpoint, event, attempt) is
 *      the second lock on the same door.
 *   2. **Claim.** Take the due rows with an `update … returning`, which is what
 *      makes two processes running this job safe rather than merely unlikely:
 *      the loser's `claimed_at is null` fails on re-evaluation and it gets the
 *      row back in the returning set of nobody.
 *   3. **Send**, a few at a time, each with its own deadline. A 2xx is a
 *      success. **A 3xx is a failure** — following a redirect would send a
 *      signed payload of somebody's timesheet to a host the address guard never
 *      checked, which is the whole attack `lib/webhook-url.ts` exists to stop.
 *   4. **Schedule the retry**, or give up on the endpoint if it has been
 *      failing for three days, and tell the organization's admins.
 *   5. **Sweep.** Clear payloads older than three days and delete log rows
 *      older than a fortnight.
 *
 * Environment variables:
 *   WEBHOOK_DELIVERY_ENABLED           - "false" to stop sending (default: on)
 *   WEBHOOK_DELIVERY_INTERVAL_MINUTES  - minutes between ticks (default: 1)
 *   WEBHOOK_DELIVERY_TIMEOUT_MS        - deadline on one POST (default: 10000)
 *   WEBHOOK_ALLOW_PRIVATE_HOSTS        - "true" to allow a private receiver
 *                                        (default: off; see lib/webhook-url.ts)
 */

import { and, asc, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";

import type { WebhookEnvelope, WebhookEventKind } from "../api/webhooks";
import { WEBHOOK_HEADERS, WEBHOOK_PAYLOAD_VERSION } from "../api/webhooks";
import { db } from "../db";
import { member, organization } from "../db/schema/auth";
import {
	webhookDelivery,
	webhookEndpoint,
	webhookEvent,
} from "../db/schema/webhooks";
import { webhookSignatureHeader } from "../lib/webhook-signature";
import { fetchWebhookTarget, resolveWebhookTarget } from "../lib/webhook-url";
import { notify } from "../services/notify";

/**
 * How long to wait before each attempt after the first.
 *
 * Seven attempts over about twenty-one hours. Stripe retries for three days;
 * this window is shorter on purpose, because the payload is deleted after three
 * (the privacy decision on issue #67) and a retry schedule that outlived the
 * thing it retries would be a lie. An endpoint that is still down after
 * twenty-one hours is not coming back inside the hour, and the events are still
 * there to Resend by hand for two more days.
 */
export const WEBHOOK_RETRY_DELAYS_MS = [
	60_000, // 1 minute
	5 * 60_000,
	30 * 60_000,
	2 * 60 * 60_000,
	6 * 60 * 60_000,
	12 * 60 * 60_000,
] as const;

/** The first attempt plus one per delay above. */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length + 1;

/** An endpoint failing this long without a single success is switched off, and
 *  the admins are told. Long enough to cover a weekend outage plus a Monday
 *  morning; short enough that a URL nobody owns any more stops being posted to. */
export const WEBHOOK_GIVE_UP_DAYS = 3;

/** The payload holds the notes people wrote, so it is cleared first and the
 *  attempt rows — status codes and timings, which say nothing about anybody —
 *  are kept a while longer. */
export const WEBHOOK_PAYLOAD_RETENTION_DAYS = 3;
export const WEBHOOK_LOG_RETENTION_DAYS = 14;

/** Events turned into deliveries per tick, and deliveries attempted per tick.
 *  A ceiling rather than a target: the tick ends and the next one continues. */
const FAN_OUT_BATCH = 500;
const SEND_BATCH = 200;
/** POSTs in flight at once. Enough that one slow receiver does not hold up
 *  another organization's events, small enough not to look like a flood. */
const SEND_CONCURRENCY = 5;

/** Kept out of the log, and out of memory: a receiver's error page is useful
 *  for the first line, not for the next megabyte. */
const RESPONSE_SAMPLE_LIMIT = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

export type WebhookDeliverySummary = {
	enabled: boolean;
	fannedOut: number;
	attempted: number;
	succeeded: number;
	failed: number;
	disabled: number;
};

// ── The wire ────────────────────────────────────────────────────────────────

export type WebhookSendResult = {
	/** Null when the request never reached a response: DNS, TLS, a timeout, or
	 *  an address the guard refused this time round. */
	statusCode: number | null;
	error: string | null;
	responseSample: string | null;
	durationMs: number;
};

export type WebhookSendRequest = {
	url: string;
	headers: Record<string, string>;
	body: string;
};

export type WebhookSender = (
	request: WebhookSendRequest,
) => Promise<WebhookSendResult>;

const timeoutMs = (): number =>
	Number(process.env.WEBHOOK_DELIVERY_TIMEOUT_MS ?? 10_000);

/** Read at most `limit` characters of a response and abandon the rest, so a
 *  receiver answering with a 40 MB stack trace costs one small string. */
const readSample = async (response: Response): Promise<string | null> => {
	if (!response.body) return null;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let text = "";
	try {
		while (text.length < RESPONSE_SAMPLE_LIMIT) {
			const { done, value } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
		}
	} catch {
		// A body that stops mid-read still leaves whatever arrived, which is more
		// useful in the log than nothing.
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	const sample = text.slice(0, RESPONSE_SAMPLE_LIMIT).trim();
	return sample.length > 0 ? sample : null;
};

const httpSender: WebhookSender = async (request) => {
	const startedAt = Date.now();
	// Resolved again, on every attempt: a name that was public when the endpoint
	// was registered can answer 127.0.0.1 an hour later. See lib/webhook-url.ts.
	const target = await resolveWebhookTarget(request.url);
	if (!target.ok) {
		return {
			statusCode: null,
			error: target.reason,
			responseSample: null,
			durationMs: Date.now() - startedAt,
		};
	}

	try {
		// To an address the check above accepted, not to a second lookup of the
		// name, which a rebinding resolver could answer with 10.0.0.5.
		const response = await fetchWebhookTarget(
			target,
			{
				method: "POST",
				headers: request.headers,
				body: request.body,
				// Manual, and a 3xx is then counted as a failure below. Following one
				// would post a signed payload to a host nothing checked.
				redirect: "manual",
			},
			timeoutMs(),
		);
		const responseSample = await readSample(response);
		const ok = response.status >= 200 && response.status < 300;
		return {
			statusCode: response.status,
			error: ok
				? null
				: response.status >= 300 && response.status < 400
					? `${String(response.status)} redirect — a webhook URL must answer directly`
					: `The endpoint answered ${String(response.status)}`,
			responseSample,
			durationMs: Date.now() - startedAt,
		};
	} catch (error) {
		return {
			statusCode: null,
			error: error instanceof Error ? error.message : String(error),
			responseSample: null,
			durationMs: Date.now() - startedAt,
		};
	}
};

let sender: WebhookSender = httpSender;

/** Substitute the wire in tests — the same seam `setNotifyAdaptersForTests`
 *  puts in front of Slack and push. Pass nothing to restore the real one. */
export const setWebhookSenderForTests = (override?: WebhookSender): void => {
	sender = override ?? httpSender;
};

// ── One tick ────────────────────────────────────────────────────────────────

type Logger = { warn: (message: string) => void };

/** Fan every unsent event out into the delivery rows it deserves. */
const fanOut = async (now: Date): Promise<number> => {
	const events = await db
		.select({
			id: webhookEvent.id,
			organizationId: webhookEvent.organizationId,
			kind: webhookEvent.kind,
			endpointId: webhookEvent.endpointId,
		})
		.from(webhookEvent)
		.where(isNull(webhookEvent.fannedOutAt))
		.orderBy(asc(webhookEvent.occurredAt))
		.limit(FAN_OUT_BATCH);
	if (events.length === 0) return 0;

	const organizationIds = [...new Set(events.map((e) => e.organizationId))];
	const endpoints = await db
		.select({
			id: webhookEndpoint.id,
			organizationId: webhookEndpoint.organizationId,
			enabledEvents: webhookEndpoint.enabledEvents,
		})
		.from(webhookEndpoint)
		.where(
			and(
				inArray(webhookEndpoint.organizationId, organizationIds),
				isNull(webhookEndpoint.disabledAt),
			),
		);
	const byOrg = new Map<string, typeof endpoints>();
	for (const endpoint of endpoints) {
		const list = byOrg.get(endpoint.organizationId) ?? [];
		list.push(endpoint);
		byOrg.set(endpoint.organizationId, list);
	}

	const rows: (typeof webhookDelivery.$inferInsert)[] = [];
	for (const event of events) {
		const candidates = (byOrg.get(event.organizationId) ?? []).filter(
			(endpoint) =>
				event.endpointId
					? // A test event is addressed to one endpoint, and that endpoint gets
						// it whether or not it subscribed to the test kind.
						endpoint.id === event.endpointId
					: endpoint.enabledEvents.includes(event.kind),
		);
		for (const endpoint of candidates) {
			rows.push({
				organizationId: event.organizationId,
				endpointId: endpoint.id,
				eventId: event.id,
				attempt: 1,
				nextAttemptAt: now,
			});
		}
	}

	if (rows.length > 0) {
		// PGLite overruns its bind-parameter handling on a very large multi-row
		// insert (see packages/core/CLAUDE.md), and the real driver is happier in
		// chunks too.
		for (let index = 0; index < rows.length; index += 200) {
			await db
				.insert(webhookDelivery)
				.values(rows.slice(index, index + 200))
				.onConflictDoNothing();
		}
	}

	// Marked fanned out even when nothing subscribed: the event has been looked
	// at, and leaving it unmarked would re-scan it on every tick for a fortnight.
	await db
		.update(webhookEvent)
		.set({ fannedOutAt: now })
		.where(
			inArray(
				webhookEvent.id,
				events.map((event) => event.id),
			),
		);
	return rows.length;
};

type ClaimedDelivery = {
	id: string;
	organizationId: string;
	endpointId: string;
	eventId: string;
	attempt: number;
};

/** Take the due rows, in a way two processes can both do at once. */
const claimDue = async (now: Date): Promise<ClaimedDelivery[]> => {
	const due = await db
		.select({ id: webhookDelivery.id })
		.from(webhookDelivery)
		.where(
			and(
				isNull(webhookDelivery.attemptedAt),
				isNull(webhookDelivery.claimedAt),
				lte(webhookDelivery.nextAttemptAt, now),
			),
		)
		.orderBy(asc(webhookDelivery.nextAttemptAt))
		.limit(SEND_BATCH);
	if (due.length === 0) return [];

	// `claimed_at is null` is re-evaluated after the row lock is taken, so a
	// second process updating the same row gets nothing back for it.
	return db
		.update(webhookDelivery)
		.set({ claimedAt: now })
		.where(
			and(
				inArray(
					webhookDelivery.id,
					due.map((row) => row.id),
				),
				isNull(webhookDelivery.claimedAt),
			),
		)
		.returning({
			id: webhookDelivery.id,
			organizationId: webhookDelivery.organizationId,
			endpointId: webhookDelivery.endpointId,
			eventId: webhookDelivery.eventId,
			attempt: webhookDelivery.attempt,
		});
};

/** Run `work` over `items`, `limit` at a time. */
const inBatches = async <T>(
	items: T[],
	limit: number,
	work: (item: T) => Promise<void>,
): Promise<void> => {
	for (let index = 0; index < items.length; index += limit) {
		await Promise.all(items.slice(index, index + limit).map(work));
	}
};

/** The secrets a payload is signed with: the current one, plus the rolled
 *  predecessor while its day is still running. */
const liveSecrets = (
	endpoint: {
		secret: string;
		previousSecret: string | null;
		previousSecretExpiresAt: Date | null;
	},
	now: Date,
): string[] => {
	const secrets = [endpoint.secret];
	if (
		endpoint.previousSecret &&
		endpoint.previousSecretExpiresAt &&
		endpoint.previousSecretExpiresAt > now
	) {
		secrets.push(endpoint.previousSecret);
	}
	return secrets;
};

/** Switch off every endpoint that has been failing for too long, and tell the
 *  organization's admins so the silence is not the first they hear of it. */
const giveUpOnDeadEndpoints = async (
	now: Date,
	logger: Logger,
): Promise<number> => {
	const cutoff = new Date(now.getTime() - WEBHOOK_GIVE_UP_DAYS * DAY_MS);
	const dead = await db
		.update(webhookEndpoint)
		.set({
			disabledAt: now,
			disabledReason: `No successful delivery for ${String(WEBHOOK_GIVE_UP_DAYS)} days`,
			updatedAt: now,
		})
		.where(
			and(
				isNull(webhookEndpoint.disabledAt),
				lt(webhookEndpoint.failingSince, cutoff),
			),
		)
		.returning({
			id: webhookEndpoint.id,
			organizationId: webhookEndpoint.organizationId,
			url: webhookEndpoint.url,
		});
	if (dead.length === 0) return 0;

	const slugs = await db
		.select({ id: organization.id, slug: organization.slug })
		.from(organization)
		.where(
			inArray(organization.id, [
				...new Set(dead.map((endpoint) => endpoint.organizationId)),
			]),
		);
	const slugById = new Map(slugs.map((row) => [row.id, row.slug]));

	for (const endpoint of dead) {
		const admins = await db
			.select({ userId: member.userId })
			.from(member)
			.where(
				and(
					eq(member.organizationId, endpoint.organizationId),
					inArray(member.role, ["owner", "admin"]),
				),
			);
		const slug = slugById.get(endpoint.organizationId);
		for (const admin of admins) {
			await notify(
				{ organizationId: endpoint.organizationId, userId: admin.userId },
				{
					kind: "webhook-disabled",
					title: "A webhook was switched off",
					body: `${endpoint.url} has not accepted a delivery for ${String(WEBHOOK_GIVE_UP_DAYS)} days, so Farmer has stopped sending to it. Fix the endpoint and turn it back on.`,
					url: slug ? `/${slug}/settings/webhooks` : undefined,
					linkLabel: "Open webhook settings",
				},
			);
		}
		logger.warn(
			`Webhook endpoint disabled after repeated failures: ${endpoint.url}`,
		);
	}
	return dead.length;
};

/** When the sweep last ran, so a one-minute tick does not scan two tables every
 *  minute for rows that age by the day. */
let lastSweepAt = 0;
const SWEEP_EVERY_MS = 60 * 60_000;

/** For a test that wants the sweep to run on its own tick. */
export const forgetWebhookSweepForTests = (): void => {
	lastSweepAt = 0;
};

const sweepRetention = async (now: Date): Promise<void> => {
	if (now.getTime() - lastSweepAt < SWEEP_EVERY_MS) return;
	lastSweepAt = now.getTime();

	await db
		.update(webhookEvent)
		.set({ data: null, dataDroppedAt: now })
		.where(
			and(
				isNull(webhookEvent.dataDroppedAt),
				lt(
					webhookEvent.occurredAt,
					new Date(now.getTime() - WEBHOOK_PAYLOAD_RETENTION_DAYS * DAY_MS),
				),
			),
		);

	const logCutoff = new Date(
		now.getTime() - WEBHOOK_LOG_RETENTION_DAYS * DAY_MS,
	);
	await db
		.delete(webhookDelivery)
		.where(lt(webhookDelivery.createdAt, logCutoff));
	// The deliveries of an event go with it, but an event with no deliveries
	// left (nothing subscribed, or its attempts were swept a moment ago) would
	// otherwise stay for ever.
	await db.delete(webhookEvent).where(lt(webhookEvent.createdAt, logCutoff));
};

/**
 * One tick.
 *
 * `now` is a parameter so a test can pin the retry schedule rather than sleep
 * through it.
 */
export const runWebhookDeliveryOnce = async (
	options: { now?: Date; logger?: Logger } = {},
): Promise<WebhookDeliverySummary> => {
	const idle: WebhookDeliverySummary = {
		enabled: false,
		fannedOut: 0,
		attempted: 0,
		succeeded: 0,
		failed: 0,
		disabled: 0,
	};
	if (process.env.WEBHOOK_DELIVERY_ENABLED === "false") return idle;

	const now = options.now ?? new Date();
	const logger = options.logger ?? { warn: () => undefined };

	const fannedOut = await fanOut(now);
	const claimed = await claimDue(now);

	let succeeded = 0;
	let failed = 0;

	if (claimed.length > 0) {
		const endpoints = await db
			.select({
				id: webhookEndpoint.id,
				url: webhookEndpoint.url,
				secret: webhookEndpoint.secret,
				previousSecret: webhookEndpoint.previousSecret,
				previousSecretExpiresAt: webhookEndpoint.previousSecretExpiresAt,
				disabledAt: webhookEndpoint.disabledAt,
			})
			.from(webhookEndpoint)
			.where(
				inArray(webhookEndpoint.id, [
					...new Set(claimed.map((row) => row.endpointId)),
				]),
			);
		const events = await db
			.select({
				id: webhookEvent.id,
				kind: webhookEvent.kind,
				data: webhookEvent.data,
				occurredAt: webhookEvent.occurredAt,
			})
			.from(webhookEvent)
			.where(
				inArray(webhookEvent.id, [
					...new Set(claimed.map((row) => row.eventId)),
				]),
			);
		const organizations = await db
			.select({
				id: organization.id,
				slug: organization.slug,
				name: organization.name,
			})
			.from(organization)
			.where(
				inArray(organization.id, [
					...new Set(claimed.map((row) => row.organizationId)),
				]),
			);

		const endpointById = new Map(endpoints.map((row) => [row.id, row]));
		const eventById = new Map(events.map((row) => [row.id, row]));
		const orgById = new Map(organizations.map((row) => [row.id, row]));

		await inBatches(claimed, SEND_CONCURRENCY, async (delivery) => {
			const endpoint = endpointById.get(delivery.endpointId);
			const event = eventById.get(delivery.eventId);
			const org = orgById.get(delivery.organizationId);

			const refuse = async (reason: string) => {
				failed += 1;
				await db
					.update(webhookDelivery)
					.set({ attemptedAt: now, error: reason, durationMs: 0 })
					.where(eq(webhookDelivery.id, delivery.id));
			};

			if (!endpoint || !event || !org) {
				await refuse("The endpoint or the event is gone");
				return;
			}
			if (endpoint.disabledAt) {
				await refuse("The endpoint was switched off before this was sent");
				return;
			}
			if (!event.data) {
				await refuse("The payload had already been deleted");
				return;
			}

			// SAFETY: `kind` and `data` are written together by `emitEvent`, which
			// takes the kind as a literal and the payload the same literal selects.
			// The column is text because Postgres has no enum of these twelve.
			const kind = event.kind as WebhookEventKind;
			const { kind: _tag, ...data } = event.data;
			const envelope: WebhookEnvelope = {
				id: event.id,
				version: WEBHOOK_PAYLOAD_VERSION,
				kind,
				createdAt: event.occurredAt.toISOString(),
				organization: { id: org.id, slug: org.slug, name: org.name },
				data,
			};
			const body = JSON.stringify(envelope);
			const timestampSeconds = Math.floor(now.getTime() / 1000);

			const result = await sender({
				url: endpoint.url,
				headers: {
					"Content-Type": "application/json",
					"User-Agent": "Farmer-Webhooks/1.0",
					[WEBHOOK_HEADERS.signature]: webhookSignatureHeader(
						liveSecrets(endpoint, now),
						body,
						timestampSeconds,
					),
					[WEBHOOK_HEADERS.event]: event.id,
					[WEBHOOK_HEADERS.delivery]: delivery.id,
					[WEBHOOK_HEADERS.endpoint]: endpoint.id,
					[WEBHOOK_HEADERS.attempt]: String(delivery.attempt),
				},
				body,
			});

			const ok = result.error === null;
			await db
				.update(webhookDelivery)
				.set({
					attemptedAt: now,
					statusCode: result.statusCode,
					error: result.error,
					responseSample: result.responseSample,
					durationMs: result.durationMs,
				})
				.where(eq(webhookDelivery.id, delivery.id));

			if (ok) {
				succeeded += 1;
				await db
					.update(webhookEndpoint)
					.set({ lastSuccessAt: now, failingSince: null, updatedAt: now })
					.where(eq(webhookEndpoint.id, endpoint.id));
				return;
			}

			failed += 1;
			// `coalesce` rather than a read-then-write: the first failure of a run
			// starts the give-up clock and every later one must leave it alone.
			await db
				.update(webhookEndpoint)
				.set({
					failingSince: sql`coalesce(${webhookEndpoint.failingSince}, ${now})`,
					updatedAt: now,
				})
				.where(eq(webhookEndpoint.id, endpoint.id));

			const delay = WEBHOOK_RETRY_DELAYS_MS[delivery.attempt - 1];
			if (delay === undefined) return;
			await db
				.insert(webhookDelivery)
				.values({
					organizationId: delivery.organizationId,
					endpointId: delivery.endpointId,
					eventId: delivery.eventId,
					attempt: delivery.attempt + 1,
					nextAttemptAt: new Date(now.getTime() + delay),
				})
				// A doubled tick that somehow claimed the same row twice must not
				// queue the same retry twice.
				.onConflictDoNothing();
		});
	}

	const disabled = await giveUpOnDeadEndpoints(now, logger);
	await sweepRetention(now);

	return {
		enabled: true,
		fannedOut,
		attempted: claimed.length,
		succeeded,
		failed,
		disabled,
	};
};
