// Registering, editing and inspecting outbound webhook endpoints.
//
// Admin only, every function, and that is not a default — an endpoint receives
// every member's time entries, with their notes. Registering one is a decision
// about the whole organization's data, so it sits at the same tier as adding a
// person.
//
// The secret is revealed exactly twice in its life: when the endpoint is
// created, and when it is rolled. Neither `list` nor `get` returns it, only the
// last four characters, and there is no "show it again" — the same rule as the
// Slack bot token and the OpenRouter key. Losing it means rolling it, which is
// one button and costs nothing, because both secrets stay valid for the day
// after a roll.

import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

import type { WebhookEventKind } from "../api/webhooks";
import { user } from "../db/schema/auth";
import {
	webhookDelivery,
	webhookEndpoint,
	webhookEvent,
} from "../db/schema/webhooks";
import {
	generateWebhookSecret,
	webhookSecretHint,
} from "../lib/webhook-signature";
import { resolveWebhookTarget } from "../lib/webhook-url";
import {
	type CreateWebhookEndpointInput,
	type ListWebhookDeliveriesInput,
	MAX_WEBHOOK_ENDPOINTS,
	type ResendWebhookDeliveryInput,
	type UpdateWebhookEndpointInput,
} from "../schema/webhooks";
import { requireAdmin } from "./context";
import { ctxDb } from "./db-ctx";
import { emitEventToEndpoint, invalidateWebhookSubscriptions } from "./events";
import type { Ctx } from "./types";

/** The URL was refused by the address rules in `lib/webhook-url.ts`. Its own
 *  class so the web layer can show `message` as a field error on the URL input
 *  rather than as a toast about the whole form. */
export class WebhookUrlRefusedError extends Error {}

/** One endpoint as the settings page sees it: no secret, and the health the
 *  page draws a badge from. */
export type WebhookEndpointView = {
	id: string;
	url: string;
	description: string | null;
	enabledEvents: WebhookEventKind[];
	/** The last four characters of the signing secret. */
	secretHint: string;
	/** Set while a rolled secret's predecessor is still being signed with. */
	previousSecretExpiresAt: Date | null;
	disabledAt: Date | null;
	disabledReason: string | null;
	lastSuccessAt: Date | null;
	failingSince: Date | null;
	createdAt: Date;
	createdByName: string | null;
};

/** One attempt, as the delivery log lists it. */
export type WebhookDeliveryView = {
	id: string;
	eventId: string;
	kind: string;
	attempt: number;
	manual: boolean;
	nextAttemptAt: Date | null;
	attemptedAt: Date | null;
	statusCode: number | null;
	error: string | null;
	responseSample: string | null;
	durationMs: number | null;
	createdAt: Date;
	/** False once the retention sweep has cleared the payload — Resend is
	 *  refused then, and the button says why. */
	canResend: boolean;
};

const toView = (row: {
	id: string;
	url: string;
	description: string | null;
	enabledEvents: string[];
	secret: string;
	previousSecretExpiresAt: Date | null;
	disabledAt: Date | null;
	disabledReason: string | null;
	lastSuccessAt: Date | null;
	failingSince: Date | null;
	createdAt: Date;
	createdByName: string | null;
}): WebhookEndpointView => ({
	id: row.id,
	url: row.url,
	description: row.description,
	// SAFETY: the column only ever holds values this app wrote, and every writer
	// goes through `enabledEvents` in `schema/webhooks.ts`, which is the Zod
	// enum of exactly these kinds. Postgres has no enum array type here to make
	// the same promise in the column definition.
	enabledEvents: row.enabledEvents as WebhookEventKind[],
	secretHint: webhookSecretHint(row.secret),
	previousSecretExpiresAt: row.previousSecretExpiresAt,
	disabledAt: row.disabledAt,
	disabledReason: row.disabledReason,
	lastSuccessAt: row.lastSuccessAt,
	failingSince: row.failingSince,
	createdAt: row.createdAt,
	createdByName: row.createdByName,
});

const endpointColumns = {
	id: webhookEndpoint.id,
	url: webhookEndpoint.url,
	description: webhookEndpoint.description,
	enabledEvents: webhookEndpoint.enabledEvents,
	secret: webhookEndpoint.secret,
	previousSecretExpiresAt: webhookEndpoint.previousSecretExpiresAt,
	disabledAt: webhookEndpoint.disabledAt,
	disabledReason: webhookEndpoint.disabledReason,
	lastSuccessAt: webhookEndpoint.lastSuccessAt,
	failingSince: webhookEndpoint.failingSince,
	createdAt: webhookEndpoint.createdAt,
	createdByName: user.name,
};

/** The URL check that needs the environment: the scheme rule and the address
 *  rules, including a fresh DNS lookup. Throws the refusal's own reason. */
const assertDeliverable = async (url: string): Promise<string> => {
	const check = await resolveWebhookTarget(url);

	if (!check.ok) throw new WebhookUrlRefusedError(check.reason);

	// The normalized form, so two registrations of the same endpoint written
	// differently ("…/hook" and "…/hook?") collide on the unique index instead
	// of both delivering.
	return check.url.toString();
};

export const webhooksService = {
	list: async (ctx: Ctx): Promise<WebhookEndpointView[]> => {
		await requireAdmin(ctx);

		const rows = await ctxDb(ctx)
			.select(endpointColumns)
			.from(webhookEndpoint)
			.leftJoin(user, eq(user.id, webhookEndpoint.createdBy))
			.where(eq(webhookEndpoint.organizationId, ctx.organizationId))
			.orderBy(desc(webhookEndpoint.createdAt));

		return rows.map(toView);
	},

	get: async (ctx: Ctx, endpointId: string): Promise<WebhookEndpointView> => {
		await requireAdmin(ctx);

		const [row] = await ctxDb(ctx)
			.select(endpointColumns)
			.from(webhookEndpoint)
			.leftJoin(user, eq(user.id, webhookEndpoint.createdBy))
			.where(
				and(
					eq(webhookEndpoint.id, endpointId),
					eq(webhookEndpoint.organizationId, ctx.organizationId),
				),
			)
			.limit(1);

		if (!row) throw new Error("Webhook endpoint not found");

		return toView(row);
	},

	/**
	 * Register an endpoint. The returned `secret` is the only time it is ever
	 * readable — the caller shows it once and then has the hint.
	 */
	create: async (
		ctx: Ctx,
		input: CreateWebhookEndpointInput,
	): Promise<{ endpoint: WebhookEndpointView; secret: string }> => {
		await requireAdmin(ctx);
		const db = ctxDb(ctx);

		const [existing] = await db
			.select({ count: count() })
			.from(webhookEndpoint)
			.where(eq(webhookEndpoint.organizationId, ctx.organizationId));

		if ((existing?.count ?? 0) >= MAX_WEBHOOK_ENDPOINTS) {
			throw new Error(
				`An organization may have at most ${String(MAX_WEBHOOK_ENDPOINTS)} webhook endpoints`,
			);
		}

		const url = await assertDeliverable(input.url);
		const secret = generateWebhookSecret();

		const [row] = await db
			.insert(webhookEndpoint)
			.values({
				organizationId: ctx.organizationId,
				url,
				description: input.description ?? null,
				secret,
				enabledEvents: input.enabledEvents,
				createdBy: ctx.userId,
			})
			.returning({ id: webhookEndpoint.id });

		if (!row) throw new Error("Could not create the webhook endpoint");

		invalidateWebhookSubscriptions(ctx.organizationId);

		return {
			endpoint: await webhooksService.get(ctx, row.id),
			secret,
		};
	},

	update: async (
		ctx: Ctx,
		input: UpdateWebhookEndpointInput,
	): Promise<WebhookEndpointView> => {
		await requireAdmin(ctx);
		// Reads through `get`, which is org-scoped, so an id from another
		// organization is a 404 before anything is written.
		await webhooksService.get(ctx, input.endpointId);

		const patch: Partial<typeof webhookEndpoint.$inferInsert> = {
			updatedAt: new Date(),
		};

		if (input.url !== undefined) patch.url = await assertDeliverable(input.url);

		if (input.description !== undefined) {
			patch.description = input.description === "" ? null : input.description;
		}

		if (input.enabledEvents !== undefined) {
			patch.enabledEvents = input.enabledEvents;
		}

		if (input.disabled !== undefined) {
			patch.disabledAt = input.disabled ? new Date() : null;
			// Switching it back on clears both the reason and the failure run, so
			// the give-up clock starts again rather than firing on the next failure.
			patch.disabledReason = input.disabled ? "Turned off by an admin" : null;

			if (!input.disabled) patch.failingSince = null;
		}

		await ctxDb(ctx)
			.update(webhookEndpoint)
			.set(patch)
			.where(
				and(
					eq(webhookEndpoint.id, input.endpointId),
					eq(webhookEndpoint.organizationId, ctx.organizationId),
				),
			);
		invalidateWebhookSubscriptions(ctx.organizationId);

		return webhooksService.get(ctx, input.endpointId);
	},

	remove: async (ctx: Ctx, endpointId: string): Promise<void> => {
		await requireAdmin(ctx);
		await ctxDb(ctx)
			.delete(webhookEndpoint)
			.where(
				and(
					eq(webhookEndpoint.id, endpointId),
					eq(webhookEndpoint.organizationId, ctx.organizationId),
				),
			);
		invalidateWebhookSubscriptions(ctx.organizationId);
	},

	/**
	 * Issue a new signing secret, keeping the old one live for 24 hours.
	 *
	 * Both secrets sign every payload in between (two `v1=` values in one
	 * header), so a receiver written the normal way — "does any v1 match mine" —
	 * keeps working while it is redeployed with the new one. A second roll
	 * inside the window discards the oldest secret rather than keeping three:
	 * whoever rolls twice in a day is not waiting on the first one.
	 */
	rollSecret: async (
		ctx: Ctx,
		endpointId: string,
	): Promise<{ secret: string }> => {
		await requireAdmin(ctx);
		const secret = generateWebhookSecret();

		const [row] = await ctxDb(ctx)
			.update(webhookEndpoint)
			.set({
				secret,
				previousSecret: sql`${webhookEndpoint.secret}`,
				previousSecretExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(webhookEndpoint.id, endpointId),
					eq(webhookEndpoint.organizationId, ctx.organizationId),
				),
			)
			.returning({ id: webhookEndpoint.id });

		if (!row) throw new Error("Webhook endpoint not found");

		return { secret };
	},

	/**
	 * Send this endpoint, and only this endpoint, a `webhook.test` event.
	 *
	 * It goes through the outbox like everything else rather than posting
	 * inline: a test that took a different path would prove the wrong thing, and
	 * a test that blocked the request for fifteen seconds would be its own
	 * problem. The page then watches the delivery log for the result.
	 */
	sendTest: async (
		ctx: Ctx,
		endpointId: string,
	): Promise<{ eventId: string }> => {
		await requireAdmin(ctx);
		const endpoint = await webhooksService.get(ctx, endpointId);

		if (endpoint.disabledAt) {
			throw new Error("Turn the endpoint back on before testing it");
		}

		const eventId = await emitEventToEndpoint(ctx, endpointId, {
			message: "This is a test event from Farmer. Nothing happened.",
		});

		if (!eventId) throw new Error("Could not queue the test event");

		return { eventId };
	},

	deliveries: async (
		ctx: Ctx,
		input: ListWebhookDeliveriesInput,
	): Promise<WebhookDeliveryView[]> => {
		await requireAdmin(ctx);
		await webhooksService.get(ctx, input.endpointId);

		const rows = await ctxDb(ctx)
			.select({
				id: webhookDelivery.id,
				eventId: webhookDelivery.eventId,
				attempt: webhookDelivery.attempt,
				manual: webhookDelivery.manual,
				nextAttemptAt: webhookDelivery.nextAttemptAt,
				attemptedAt: webhookDelivery.attemptedAt,
				statusCode: webhookDelivery.statusCode,
				error: webhookDelivery.error,
				responseSample: webhookDelivery.responseSample,
				durationMs: webhookDelivery.durationMs,
				createdAt: webhookDelivery.createdAt,
				kind: webhookEvent.kind,
				dataDroppedAt: webhookEvent.dataDroppedAt,
			})
			.from(webhookDelivery)
			.innerJoin(webhookEvent, eq(webhookEvent.id, webhookDelivery.eventId))
			.where(
				and(
					eq(webhookDelivery.organizationId, ctx.organizationId),
					eq(webhookDelivery.endpointId, input.endpointId),
				),
			)
			.orderBy(desc(webhookDelivery.createdAt))
			.limit(input.limit);

		return rows.map((row) => ({
			id: row.id,
			eventId: row.eventId,
			kind: row.kind,
			attempt: row.attempt,
			manual: row.manual,
			// A row still waiting is the only one whose next attempt is a promise
			// rather than a historical fact.
			nextAttemptAt: row.attemptedAt ? null : row.nextAttemptAt,
			attemptedAt: row.attemptedAt,
			statusCode: row.statusCode,
			error: row.error,
			responseSample: row.responseSample,
			durationMs: row.durationMs,
			createdAt: row.createdAt,
			canResend: row.dataDroppedAt === null && row.attemptedAt !== null,
		}));
	},

	/**
	 * Queue one more attempt at the event behind a logged delivery.
	 *
	 * The new row continues the attempt numbering rather than starting over —
	 * it is the Nth time this event went to this endpoint, whoever asked — and
	 * carries `manual`, so the log can say which tries were the schedule's and
	 * which were somebody's button.
	 */
	resend: async (
		ctx: Ctx,
		input: ResendWebhookDeliveryInput,
	): Promise<{ deliveryId: string }> => {
		await requireAdmin(ctx);
		const db = ctxDb(ctx);

		const [source] = await db
			.select({
				endpointId: webhookDelivery.endpointId,
				eventId: webhookDelivery.eventId,
				dataDroppedAt: webhookEvent.dataDroppedAt,
			})
			.from(webhookDelivery)
			.innerJoin(webhookEvent, eq(webhookEvent.id, webhookDelivery.eventId))
			.where(
				and(
					eq(webhookDelivery.id, input.deliveryId),
					eq(webhookDelivery.organizationId, ctx.organizationId),
				),
			)
			.limit(1);

		if (!source) throw new Error("Delivery not found");

		if (source.dataDroppedAt) {
			throw new Error(
				"This event's payload has been deleted, so it cannot be sent again",
			);
		}

		const [highest] = await db
			.select({ attempt: sql<number>`max(${webhookDelivery.attempt})::int` })
			.from(webhookDelivery)
			.where(
				and(
					eq(webhookDelivery.endpointId, source.endpointId),
					eq(webhookDelivery.eventId, source.eventId),
				),
			);

		const [row] = await db
			.insert(webhookDelivery)
			.values({
				organizationId: ctx.organizationId,
				endpointId: source.endpointId,
				eventId: source.eventId,
				attempt: (highest?.attempt ?? 0) + 1,
				manual: true,
				nextAttemptAt: new Date(),
			})
			.returning({ id: webhookDelivery.id });

		if (!row) throw new Error("Could not queue the delivery");

		return { deliveryId: row.id };
	},

	/** The payload a delivery carried, for the log's detail panel. Null once the
	 *  retention sweep has cleared it. */
	eventPayload: async (ctx: Ctx, eventId: string) => {
		await requireAdmin(ctx);

		const [row] = await ctxDb(ctx)
			.select({
				kind: webhookEvent.kind,
				data: webhookEvent.data,
				occurredAt: webhookEvent.occurredAt,
				dataDroppedAt: webhookEvent.dataDroppedAt,
			})
			.from(webhookEvent)
			.where(
				and(
					eq(webhookEvent.id, eventId),
					eq(webhookEvent.organizationId, ctx.organizationId),
				),
			)
			.limit(1);

		if (!row) throw new Error("Event not found");

		return row;
	},

	/** How many endpoints of this organization are live, and whether anything is
	 *  queued — the two numbers the settings hub row shows. */
	summary: async (ctx: Ctx) => {
		await requireAdmin(ctx);
		const db = ctxDb(ctx);

		const [endpoints] = await db
			.select({
				total: count(),
				live: sql<number>`count(*) filter (where ${webhookEndpoint.disabledAt} is null)::int`,
			})
			.from(webhookEndpoint)
			.where(eq(webhookEndpoint.organizationId, ctx.organizationId));

		const [queued] = await db
			.select({ count: count() })
			.from(webhookDelivery)
			.where(
				and(
					eq(webhookDelivery.organizationId, ctx.organizationId),
					isNull(webhookDelivery.attemptedAt),
				),
			);

		return {
			total: endpoints?.total ?? 0,
			live: endpoints?.live ?? 0,
			queued: queued?.count ?? 0,
		};
	},
};
