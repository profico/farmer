// Telling another system something.
//
// The sibling of `notify.ts`, and the same idea one step further out: `notify`
// is the single way this app tells a PERSON something, and this is the single
// way it tells a SERVER. Both exist because the alternative is a `fetch` in the
// middle of a decision — four call sites each with their own retry, their own
// swallowed error and their own idea of who may be contacted.
//
// One rule holds the design up: **nothing here calls out.** `emitEvent` writes
// one row to the `webhook_event` outbox, in the transaction of whatever caused
// it, and returns. A time entry and the record that it happened commit or roll
// back together, and the request ends without waiting for anybody's server.
// `jobs/webhook-delivery.ts` does the rest, on its own clock, with the retries
// and the log.
//
// ── Why `build` is a function ───────────────────────────────────────────────
//
// Because almost no organization has an endpoint, and every one of them writes
// time entries all day. A payload is a projection over three joins plus the
// person's name, so building it eagerly would put a query on the hot path of
// every write in the product in exchange for a row that is deleted unread.
//
// `webhookWants` answers from a 60-second cache, so the common case is a Map
// lookup and a return. `build` runs only when somebody actually asked for that
// kind. The cost of webhooks is paid by the organizations that use them.
//
// The cache is why a new endpoint can take up to a minute to start receiving.
// `invalidateWebhookSubscriptions` makes that instant within one process; the
// web host and the worker are two processes, so the TTL is the real bound and
// the settings page says so.
//
// ── What does NOT emit, and why it is written down ──────────────────────────
//
// The automation engines: fill blocks, synced meetings, materialized recurring
// blocks and the commit/PR work blocks. They reconcile rather than append — a
// sweep rewrites a block every twenty minutes as the day fills up — so a row
// there is not "something happened", it is "the same thing, recalculated". The
// Harvest import is silent for the same reason and sends `import.finished`
// instead, with the counts. Both limits are in `docs/domains/webhooks.md`,
// because a receiver that sees a person's typed entries and not their synced
// meetings needs to know that is the rule and not a bug.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type {
	WebhookClient,
	WebhookEventData,
	WebhookEventKind,
	WebhookEventPayloads,
	WebhookMember,
	WebhookProject,
	WebhookTimeEntry,
} from "../api/webhooks";
import { user } from "../db/schema/auth";
import { client, project, timeEntry } from "../db/schema/domain";
import { webhookEndpoint, webhookEvent } from "../db/schema/webhooks";
import { loggableError } from "../lib/loggable-error";
import { shownName } from "./claim-name";
import { ctxDb } from "./db-ctx";
import type { Ctx } from "./types";

/** How long a "who is subscribed" answer is reused. Short enough that turning
 *  an endpoint on feels immediate, long enough that a busy organization does
 *  not ask once per time entry. */
export const WEBHOOK_SUBSCRIPTION_CACHE_MS = 60_000;

type SubscriptionEntry = { kinds: Set<string>; expiresAt: number };
const subscriptions = new Map<string, SubscriptionEntry>();

/** Drop an organization's cached subscriptions, after an endpoint of theirs was
 *  created, edited, disabled or removed. Process-local — see the header. */
export const invalidateWebhookSubscriptions = (
	organizationId: string,
): void => {
	subscriptions.delete(organizationId);
};

/** For the tests, and for a process that has just been told the whole table is
 *  stale. */
export const clearWebhookSubscriptionCacheForTests = (): void => {
	subscriptions.clear();
};

const subscribedKinds = async (ctx: Ctx): Promise<Set<string>> => {
	const cached = subscriptions.get(ctx.organizationId);
	if (cached && cached.expiresAt > Date.now()) return cached.kinds;

	// On `ctxDb`, never the ambient handle: this runs from inside the caller's
	// transaction, and a second connection taken while holding the first is the
	// deadlock `services/db-ctx.ts` describes.
	const rows = await ctxDb(ctx)
		.select({ enabledEvents: webhookEndpoint.enabledEvents })
		.from(webhookEndpoint)
		.where(
			and(
				eq(webhookEndpoint.organizationId, ctx.organizationId),
				isNull(webhookEndpoint.disabledAt),
			),
		);
	const kinds = new Set(rows.flatMap((row) => row.enabledEvents));
	subscriptions.set(ctx.organizationId, {
		kinds,
		expiresAt: Date.now() + WEBHOOK_SUBSCRIPTION_CACHE_MS,
	});
	return kinds;
};

/**
 * Whether any live endpoint of this organization asked for `kind`.
 *
 * Exported for the one shape `emitEvent` cannot serve: a delete, where the
 * payload has to be read BEFORE the row goes and there is nothing left to build
 * it from afterwards.
 */
export const webhookWants = async (
	ctx: Ctx,
	kind: WebhookEventKind,
): Promise<boolean> => {
	if (process.env.WEBHOOK_DELIVERY_ENABLED === "false") return false;
	return (await subscribedKinds(ctx)).has(kind);
};

/**
 * Write one event to the outbox, if anybody asked for its kind.
 *
 * `build` runs only when they did, and may answer null for "on second thoughts,
 * nothing happened" — a delete that removed no row, an update that changed
 * nothing.
 *
 * Never throws. A webhook is a consequence of a decision that has already been
 * made, and it must not undo it. The one failure it cannot swallow is a
 * database error inside the caller's transaction, which Postgres has already
 * aborted by the time this catch runs; that is a bug in the insert below, not a
 * case to handle.
 */
export const emitEvent = async <K extends WebhookEventKind>(
	ctx: Ctx,
	kind: K,
	build: () =>
		| Promise<WebhookEventPayloads[K] | null>
		| WebhookEventPayloads[K]
		| null,
): Promise<void> => {
	try {
		if (!(await webhookWants(ctx, kind))) return;
		const data = await build();
		if (!data) return;
		await ctxDb(ctx)
			.insert(webhookEvent)
			.values({
				organizationId: ctx.organizationId,
				kind,
				// SAFETY: `kind` is the literal key the caller passed and `data` is
				// the payload the same key selected, so the pair is one member of the
				// `WebhookEventData` union by construction. TypeScript cannot narrow a
				// generic `K` to a single member of a mapped union, so it sees the
				// cross product instead of the twelve valid pairs.
				data: { kind, ...data } as WebhookEventData,
			});
	} catch (error) {
		console.error("[events] could not write webhook event", {
			kind,
			organizationId: ctx.organizationId,
			error: loggableError(error),
		});
	}
};

/**
 * Write an event addressed to ONE endpoint — what "Send test event" sends.
 *
 * Bypasses `webhookWants` on purpose: the test kind is the one thing an
 * endpoint cannot unsubscribe from, because a button that silently sent nothing
 * would be worse than no button.
 */
export const emitEventToEndpoint = async (
	ctx: Ctx,
	endpointId: string,
	data: WebhookEventPayloads["webhook.test"],
): Promise<string | null> => {
	const [row] = await ctxDb(ctx)
		.insert(webhookEvent)
		.values({
			organizationId: ctx.organizationId,
			kind: "webhook.test",
			endpointId,
			data: { kind: "webhook.test", ...data },
		})
		.returning({ id: webhookEvent.id });
	return row?.id ?? null;
};

// ── The projections ─────────────────────────────────────────────────────────
//
// Every builder below answers a shape from `api/webhooks.ts` and never a row.
// They live here rather than in `api/` because they query; `api/` is types
// only, since the CLI binary imports it.

const toWebhookMember = (row: {
	id: string;
	name: string | null;
	email: string | null;
}): WebhookMember => ({
	id: row.id,
	name: row.name ?? "",
	email: row.email ?? "",
});

/** One time entry, with the person it belongs to. Null when the row is not
 *  there (or not this organization's), which is the answer for a delete that
 *  deleted nothing. */
export const timeEntryWebhookPayload = async (
	ctx: Ctx,
	timeEntryId: string,
): Promise<{ entry: WebhookTimeEntry; member: WebhookMember } | null> => {
	const payloads = await timeEntryWebhookPayloads(ctx, [timeEntryId]);
	return payloads[0] ?? null;
};

/** The same, for a batch — one query for a whole copied week rather than forty.
 *  Returned in the order the ids were given, minus the ones that were not
 *  found. */
export const timeEntryWebhookPayloads = async (
	ctx: Ctx,
	timeEntryIds: string[],
): Promise<{ entry: WebhookTimeEntry; member: WebhookMember }[]> => {
	if (timeEntryIds.length === 0) return [];
	const db = ctxDb(ctx);
	const rows = await db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, ctx.organizationId),
			inArray(timeEntry.id, timeEntryIds),
		),
		with: { task: true, project: { with: { client: true } } },
	});
	if (rows.length === 0) return [];

	const people = await db
		.select({
			id: user.id,
			name: shownName(ctx.organizationId),
			email: user.email,
		})
		.from(user)
		.where(inArray(user.id, [...new Set(rows.map((row) => row.userId))]));
	const byUserId = new Map(people.map((person) => [person.id, person]));
	const byId = new Map(rows.map((row) => [row.id, row]));

	const payloads: { entry: WebhookTimeEntry; member: WebhookMember }[] = [];
	for (const id of timeEntryIds) {
		const row = byId.get(id);
		if (!row) continue;
		const person = byUserId.get(row.userId);
		if (!person) continue;
		payloads.push({
			member: toWebhookMember(person),
			entry: {
				id: row.id,
				date: row.date,
				durationSeconds: row.durationSeconds,
				description: row.description,
				overtime: row.overtime,
				fillsDay: row.fillsDay,
				synced: row.calendarEventId != null,
				task: {
					id: row.task.id,
					name: row.task.name,
					isAbsence: row.task.isAbsence,
				},
				project: row.project
					? {
							id: row.project.id,
							name: row.project.name,
							code: row.project.code,
							client: {
								id: row.project.client.id,
								name: row.project.client.name,
							},
						}
					: null,
			},
		});
	}
	return payloads;
};

/** Which of the two families a time entry's events belong to. An absence is
 *  its own subject — somebody being away is a different fact from somebody
 *  working, and a receiver that syncs holidays wants one and not the other. */
export const isAbsenceEntryKind = (isAbsence: boolean) => ({
	created: isAbsence
		? ("absence.created" as const)
		: ("time_entry.created" as const),
	deleted: isAbsence
		? ("absence.removed" as const)
		: ("time_entry.deleted" as const),
});

export const projectWebhookPayload = async (
	ctx: Ctx,
	projectId: string,
): Promise<{ project: WebhookProject } | null> => {
	const row = await ctxDb(ctx).query.project.findFirst({
		where: and(
			eq(project.id, projectId),
			eq(project.organizationId, ctx.organizationId),
		),
		with: { client: true },
	});
	if (!row) return null;
	return {
		project: {
			id: row.id,
			name: row.name,
			code: row.code,
			status: row.status,
			client: row.client ? { id: row.client.id, name: row.client.name } : null,
		},
	};
};

export const clientWebhookPayload = async (
	ctx: Ctx,
	clientId: string,
): Promise<{ client: WebhookClient } | null> => {
	const [row] = await ctxDb(ctx)
		.select({ id: client.id, name: client.name })
		.from(client)
		.where(
			and(
				eq(client.id, clientId),
				eq(client.organizationId, ctx.organizationId),
			),
		)
		.limit(1);
	if (!row) return null;
	return { client: { id: row.id, name: row.name } };
};

export const memberWebhookPayload = async (
	ctx: Ctx,
	userId: string,
): Promise<{ member: WebhookMember } | null> => {
	const [row] = await ctxDb(ctx)
		.select({
			id: user.id,
			name: shownName(ctx.organizationId),
			email: user.email,
		})
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!row) return null;
	return { member: toWebhookMember(row) };
};

/** How many events are waiting to be sent, for the settings page's "delivery is
 *  behind" line. `sql` count rather than a fetch: the number can be large and
 *  nothing needs the rows. */
export const pendingWebhookEventCount = async (ctx: Ctx): Promise<number> => {
	const [row] = await ctxDb(ctx)
		.select({ count: sql<number>`count(*)::int` })
		.from(webhookEvent)
		.where(
			and(
				eq(webhookEvent.organizationId, ctx.organizationId),
				isNull(webhookEvent.fannedOutAt),
			),
		);
	return row?.count ?? 0;
};
