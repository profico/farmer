// Outbound webhooks, end to end on a real Postgres.
//
// What is pinned here is the four things issue #67 asked for — a known
// signature on the wire, the retry schedule, the give-up rule, and that an
// endpoint receives its own organization's events and nobody else's — plus the
// two rules that are easy to break later without noticing: the secret is never
// readable after it is issued, and a payload is not written at all when nothing
// is subscribed.

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";

import { and, asc, eq } from "drizzle-orm";

import type { WebhookEventKind } from "../api/webhooks";
import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import {
	webhookDelivery,
	webhookEndpoint,
	webhookEvent,
} from "../db/schema/webhooks";
import {
	forgetWebhookSweepForTests,
	runWebhookDeliveryOnce,
	setWebhookSenderForTests,
	WEBHOOK_GIVE_UP_DAYS,
	WEBHOOK_LOG_RETENTION_DAYS,
	WEBHOOK_MAX_ATTEMPTS,
	WEBHOOK_PAYLOAD_RETENTION_DAYS,
	type WebhookSendRequest,
} from "../jobs/webhook-delivery";
import {
	parseWebhookSignature,
	verifyWebhookSignature,
} from "../lib/webhook-signature";
import { at, createTestDb, present, type TestDb } from "../test/harness";
import { clearWebhookSubscriptionCacheForTests, emitEvent } from "./events";
import { setNotifyAdaptersForTests } from "./notify";
import type { Ctx } from "./types";
import { webhooksService } from "./webhooks.service";

const ORG = "org-hooks";

const OTHER_ORG = "org-hooks-other";

const ADMIN = "user-hooks-admin";

const PLAIN = "user-hooks-member";

const OTHER_ADMIN = "user-hooks-other-admin";

const adminCtx: Ctx = { organizationId: ORG, userId: ADMIN };

const plainCtx: Ctx = { organizationId: ORG, userId: PLAIN };

const otherCtx: Ctx = { organizationId: OTHER_ORG, userId: OTHER_ADMIN };

let harness: TestDb;

/** A sender that records what went out and answers however the test says. */
const recorder = (status = 200) => {
	const sent: WebhookSendRequest[] = [];
	setWebhookSenderForTests(async (request) => {
		sent.push(request);
		const ok = status >= 200 && status < 300;

		return Promise.resolve({
			statusCode: status,
			error: ok ? null : `The endpoint answered ${String(status)}`,
			responseSample: ok ? "ok" : "no",
			durationMs: 3,
		});
	});

	return sent;
};

const anEndpoint = (
	ctx: Ctx,
	url: string,
	kinds: WebhookEventKind[] = ["client.created"],
) => webhooksService.create(ctx, { url, enabledEvents: kinds });

const deliveriesFor = (endpointId: string) =>
	db
		.select()
		.from(webhookDelivery)
		.where(eq(webhookDelivery.endpointId, endpointId))
		.orderBy(asc(webhookDelivery.attempt));

beforeAll(async () => {
	harness = await createTestDb();
	await db.insert(organization).values([
		{ id: ORG, name: "Hooks", slug: ORG, createdAt: new Date() },
		{ id: OTHER_ORG, name: "Other", slug: OTHER_ORG, createdAt: new Date() },
	]);

	const person = (id: string, email: string) => ({
		id,
		name: id,
		email,
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	await db
		.insert(user)
		.values([
			person(ADMIN, "admin@example.com"),
			person(PLAIN, "plain@example.com"),
			person(OTHER_ADMIN, "other@example.com"),
		]);
	await db.insert(member).values([
		{
			id: "mh1",
			organizationId: ORG,
			userId: ADMIN,
			role: "owner",
			createdAt: new Date(),
		},
		{
			id: "mh2",
			organizationId: ORG,
			userId: PLAIN,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "mh3",
			organizationId: OTHER_ORG,
			userId: OTHER_ADMIN,
			role: "owner",
			createdAt: new Date(),
		},
	]);
});

beforeEach(() => {
	clearWebhookSubscriptionCacheForTests();
	forgetWebhookSweepForTests();
});

afterEach(async () => {
	setWebhookSenderForTests();
	setNotifyAdaptersForTests();
	await db.delete(webhookDelivery);
	await db.delete(webhookEvent);
	await db.delete(webhookEndpoint);
	clearWebhookSubscriptionCacheForTests();
});

afterAll(async () => {
	await harness.close();
});

describe("who may register an endpoint", () => {
	test("an admin may", async () => {
		const { endpoint } = await anEndpoint(adminCtx, "https://8.8.8.8/hook");
		expect(endpoint.url).toBe("https://8.8.8.8/hook");
	});

	// An endpoint receives every member's time, with their notes, so this is
	// the same tier as adding a person — not a project-level permission.
	test("a plain member may not, and cannot even list", async () => {
		expect(anEndpoint(plainCtx, "https://8.8.8.8/hook")).rejects.toThrow(
			/Admin access required/,
		);
		expect(webhooksService.list(plainCtx)).rejects.toThrow(
			/Admin access required/,
		);
	});
});

describe("the secret", () => {
	test("is returned once at creation and never again", async () => {
		const { endpoint, secret } = await anEndpoint(
			adminCtx,
			"https://8.8.8.8/hook",
		);

		expect(secret.startsWith("whsec_")).toBe(true);
		expect(endpoint.secretHint).toBe(secret.slice(-4));

		const listed = at(await webhooksService.list(adminCtx), 0);
		// The view type has no `secret` field at all, so this is belt and braces
		// against somebody widening it later.
		expect(JSON.stringify(listed)).not.toContain(secret);
		expect(listed.secretHint).toBe(secret.slice(-4));
	});

	test("a roll keeps the old one signing for a day", async () => {
		const { endpoint, secret } = await anEndpoint(
			adminCtx,
			"https://8.8.8.8/hook",
		);

		const rolled = await webhooksService.rollSecret(adminCtx, endpoint.id);
		expect(rolled.secret).not.toBe(secret);

		const sent = recorder();
		await webhooksService.sendTest(adminCtx, endpoint.id);
		await runWebhookDeliveryOnce();

		const header = present(
			at(sent, 0).headers["Farmer-Signature"],
			"the signature header",
		);

		expect(parseWebhookSignature(header)?.signatures).toHaveLength(2);
		const now = Math.floor(Date.now() / 1000);

		for (const candidate of [secret, rolled.secret]) {
			expect(
				verifyWebhookSignature({
					header,
					body: at(sent, 0).body,
					secret: candidate,
					now,
				}),
			).toBe(true);
		}
	});
});

describe("the URL rules reach the service", () => {
	test("http and a loopback address are refused", async () => {
		expect(anEndpoint(adminCtx, "http://8.8.8.8/hook")).rejects.toThrow(
			/https/,
		);
		expect(anEndpoint(adminCtx, "https://127.0.0.1/hook")).rejects.toThrow(
			/not reachable from the public internet/,
		);
	});

	test("an organization may not register more than the cap", async () => {
		for (let index = 0; index < 5; index += 1) {
			await anEndpoint(adminCtx, `https://8.8.8.${String(index)}/hook`);
		}

		expect(anEndpoint(adminCtx, "https://8.8.8.9/hook")).rejects.toThrow(
			/at most/,
		);
	});
});

describe("what reaches the wire", () => {
	test("the envelope, the headers, and a signature the receiver can check", async () => {
		const { endpoint, secret } = await anEndpoint(
			adminCtx,
			"https://8.8.8.8/hook",
		);

		const sent = recorder();
		await emitEvent(adminCtx, "client.created", () => ({
			client: { id: "client-1", name: "Acme" },
		}));
		const summary = await runWebhookDeliveryOnce();

		expect(summary.succeeded).toBe(1);
		const request = at(sent, 0);

		// SAFETY: the body is what the delivery job just serialized from a
		// `WebhookEnvelope`, so its shape is this file's own fixture read back.
		const envelope = JSON.parse(request.body) as {
			id: string;
			kind: string;
			version: string;
			organization: { slug: string };
			data: { client: { name: string } };
		};

		expect(envelope.kind).toBe("client.created");
		expect(envelope.organization.slug).toBe(ORG);
		expect(envelope.data.client.name).toBe("Acme");
		// The body carries the id a receiver dedupes on, and the header repeats it.
		expect(request.headers["Farmer-Event"]).toBe(envelope.id);
		expect(request.headers["Farmer-Webhook-Id"]).toBe(endpoint.id);
		expect(request.headers["Farmer-Attempt"]).toBe("1");
		expect(
			verifyWebhookSignature({
				header: present(request.headers["Farmer-Signature"], "signature"),
				body: request.body,
				secret,
				now: Math.floor(Date.now() / 1000),
			}),
		).toBe(true);
	});

	test("an endpoint gets nothing of another organization's", async () => {
		const { endpoint } = await anEndpoint(adminCtx, "https://8.8.8.8/hook");
		const sent = recorder();

		await emitEvent(otherCtx, "client.created", () => ({
			client: { id: "client-2", name: "Not yours" },
		}));
		await runWebhookDeliveryOnce();

		expect(sent).toHaveLength(0);
		expect(await deliveriesFor(endpoint.id)).toHaveLength(0);
	});

	test("an endpoint gets nothing it did not subscribe to", async () => {
		const { endpoint } = await anEndpoint(adminCtx, "https://8.8.8.8/hook", [
			"project.created",
		]);

		const sent = recorder();
		await emitEvent(adminCtx, "client.created", () => ({
			client: { id: "client-3", name: "Acme" },
		}));
		await runWebhookDeliveryOnce();
		expect(sent).toHaveLength(0);
		expect(await deliveriesFor(endpoint.id)).toHaveLength(0);
	});

	// The reason `emitEvent` takes a function: an organization with no endpoint
	// must not pay a query, let alone a row, for every time entry in the product.
	test("nothing is written, and the payload never built, when nobody is listening", async () => {
		let built = 0;
		await emitEvent(adminCtx, "client.created", () => {
			built += 1;

			return { client: { id: "client-4", name: "Acme" } };
		});
		expect(built).toBe(0);
		expect(await db.select().from(webhookEvent)).toHaveLength(0);
	});
});

describe("the retry schedule", () => {
	test("backs off, and stops after the last attempt", async () => {
		const { endpoint } = await anEndpoint(adminCtx, "https://8.8.8.8/hook");
		recorder(500);
		await emitEvent(adminCtx, "client.created", () => ({
			client: { id: "client-5", name: "Acme" },
		}));

		// Each tick sends whatever is due and queues the next try; the clock is a
		// parameter so the schedule is checked rather than slept through.
		let now = new Date("2026-09-17T09:00:00Z");

		for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt += 1) {
			await runWebhookDeliveryOnce({ now });
			const rows = await deliveriesFor(endpoint.id);

			if (attempt < WEBHOOK_MAX_ATTEMPTS) {
				expect(rows).toHaveLength(attempt + 1);
				now = present(at(rows, attempt).nextAttemptAt, "the next attempt");
			} else {
				// The last failure queues nothing: seven tries over about a day is
				// where the automatic schedule gives up and Resend takes over.
				expect(rows).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
			}
		}

		const rows = await deliveriesFor(endpoint.id);

		const gapMinutes = (index: number) =>
			(at(rows, index).nextAttemptAt.getTime() -
				at(rows, index - 1).nextAttemptAt.getTime()) /
			60_000;

		expect(gapMinutes(1)).toBe(1);
		expect(gapMinutes(2)).toBe(5);
		expect(gapMinutes(3)).toBe(30);
		expect(gapMinutes(4)).toBe(120);
	});

	// Stripe's rule, and the reason is this app's own: following a redirect
	// would post a signed payload to a host the address guard never saw.
	test("a redirect is a failure, not a hop", async () => {
		const { endpoint } = await anEndpoint(adminCtx, "https://8.8.8.8/hook");
		setWebhookSenderForTests(() =>
			Promise.resolve({
				statusCode: 302,
				error: "302 redirect — a webhook URL must answer directly",
				responseSample: null,
				durationMs: 1,
			}),
		);
		await emitEvent(adminCtx, "client.created", () => ({
			client: { id: "client-6", name: "Acme" },
		}));
		const summary = await runWebhookDeliveryOnce();
		expect(summary.failed).toBe(1);
		expect(at(await deliveriesFor(endpoint.id), 0).statusCode).toBe(302);
	});

	test("a success clears the failure run", async () => {
		const { endpoint } = await anEndpoint(adminCtx, "https://8.8.8.8/hook");
		recorder(500);
		await emitEvent(adminCtx, "client.created", () => ({
			client: { id: "client-7", name: "Acme" },
		}));
		await runWebhookDeliveryOnce();
		expect(
			at(
				await db
					.select()
					.from(webhookEndpoint)
					.where(eq(webhookEndpoint.id, endpoint.id)),
				0,
			).failingSince,
		).not.toBeNull();

		recorder(200);
		await emitEvent(adminCtx, "client.created", () => ({
			client: { id: "client-8", name: "Acme" },
		}));
		await runWebhookDeliveryOnce();

		const after = at(
			await db
				.select()
				.from(webhookEndpoint)
				.where(eq(webhookEndpoint.id, endpoint.id)),
			0,
		);

		expect(after.failingSince).toBeNull();
		expect(after.lastSuccessAt).not.toBeNull();
	});
});

describe("giving up on an endpoint", () => {
	test("switches it off and tells the admins", async () => {
		const { endpoint } = await anEndpoint(adminCtx, "https://8.8.8.8/hook");
		const told: string[] = [];
		setNotifyAdaptersForTests({
			slack: (to) => {
				told.push(to.userId);

				return Promise.resolve(true);
			},
			push: () => Promise.resolve(true),
		});

		// Failing since before the cutoff, with no success to break the run.
		const longAgo = new Date(
			Date.now() - (WEBHOOK_GIVE_UP_DAYS + 1) * 24 * 60 * 60 * 1000,
		);

		await db
			.update(webhookEndpoint)
			.set({ failingSince: longAgo })
			.where(eq(webhookEndpoint.id, endpoint.id));

		const summary = await runWebhookDeliveryOnce();
		expect(summary.disabled).toBe(1);

		const after = await webhooksService.get(adminCtx, endpoint.id);
		expect(after.disabledAt).not.toBeNull();
		expect(after.disabledReason).toContain(String(WEBHOOK_GIVE_UP_DAYS));
		// The owner, and not the plain member.
		expect(told).toEqual([ADMIN]);
	});

	test("a disabled endpoint receives nothing, and turning it back on resets the clock", async () => {
		const { endpoint } = await anEndpoint(adminCtx, "https://8.8.8.8/hook");
		await db
			.update(webhookEndpoint)
			.set({ disabledAt: new Date(), failingSince: new Date() })
			.where(eq(webhookEndpoint.id, endpoint.id));
		clearWebhookSubscriptionCacheForTests();

		const sent = recorder();
		await emitEvent(adminCtx, "client.created", () => ({
			client: { id: "client-9", name: "Acme" },
		}));
		await runWebhookDeliveryOnce();
		expect(sent).toHaveLength(0);

		const back = await webhooksService.update(adminCtx, {
			endpointId: endpoint.id,
			disabled: false,
		});

		expect(back.disabledAt).toBeNull();
		expect(back.failingSince).toBeNull();
	});
});

describe("retention", () => {
	test("the payload goes before the log does", async () => {
		const { endpoint } = await anEndpoint(adminCtx, "https://8.8.8.8/hook");
		recorder();
		await emitEvent(adminCtx, "client.created", () => ({
			client: { id: "client-10", name: "Acme" },
		}));
		await runWebhookDeliveryOnce();

		const eventId = at(await deliveriesFor(endpoint.id), 0).eventId;
		const day = 24 * 60 * 60 * 1000;

		// Past the payload window, inside the log window.
		forgetWebhookSweepForTests();
		await runWebhookDeliveryOnce({
			now: new Date(Date.now() + (WEBHOOK_PAYLOAD_RETENTION_DAYS + 1) * day),
		});

		const swept = at(
			await db.select().from(webhookEvent).where(eq(webhookEvent.id, eventId)),
			0,
		);

		expect(swept.data).toBeNull();
		expect(swept.dataDroppedAt).not.toBeNull();
		// The attempt is still there to read, with its status code.
		expect(await deliveriesFor(endpoint.id)).toHaveLength(1);

		// And Resend now refuses rather than sending an empty body.
		const logged = at(
			await webhooksService.deliveries(adminCtx, {
				endpointId: endpoint.id,
				limit: 50,
			}),
			0,
		);

		expect(logged.canResend).toBe(false);
		expect(
			webhooksService.resend(adminCtx, { deliveryId: logged.id }),
		).rejects.toThrow(/deleted/);

		// Past the log window.
		forgetWebhookSweepForTests();
		await runWebhookDeliveryOnce({
			now: new Date(Date.now() + (WEBHOOK_LOG_RETENTION_DAYS + 1) * day),
		});
		expect(await deliveriesFor(endpoint.id)).toHaveLength(0);
		expect(await db.select().from(webhookEvent)).toHaveLength(0);
	});
});

describe("resend", () => {
	test("queues one more attempt, marked as a person's", async () => {
		const { endpoint } = await anEndpoint(adminCtx, "https://8.8.8.8/hook");
		const sent = recorder(500);
		await emitEvent(adminCtx, "client.created", () => ({
			client: { id: "client-11", name: "Acme" },
		}));
		await runWebhookDeliveryOnce();

		const first = at(await deliveriesFor(endpoint.id), 0);
		await webhooksService.resend(adminCtx, { deliveryId: first.id });

		const queued = await db
			.select()
			.from(webhookDelivery)
			.where(
				and(
					eq(webhookDelivery.endpointId, endpoint.id),
					eq(webhookDelivery.manual, true),
				),
			);

		expect(queued).toHaveLength(1);

		await runWebhookDeliveryOnce();
		// The same event, sent again — the receiver's own dedupe on the event id
		// is what protects it, which is why the docs say to use it.
		expect(sent.length).toBeGreaterThan(1);
		expect(at(sent, 0).body).toBe(at(sent, sent.length - 1).body);
	});
});

describe("the test event", () => {
	test("goes only to the endpoint it was sent from", async () => {
		const { endpoint } = await anEndpoint(adminCtx, "https://8.8.8.8/hook");
		const other = await anEndpoint(adminCtx, "https://8.8.4.4/hook");
		const sent = recorder();

		await webhooksService.sendTest(adminCtx, endpoint.id);
		await runWebhookDeliveryOnce();

		expect(sent).toHaveLength(1);
		expect(at(sent, 0).headers["Farmer-Webhook-Id"]).toBe(endpoint.id);
		expect(await deliveriesFor(other.endpoint.id)).toHaveLength(0);
	});
});
