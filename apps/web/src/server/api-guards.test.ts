// The guards of the REST routes, through the real route handlers: the cookie
// that a write must not take, the sign-in that an API token cannot stand in
// for, and the phone routes that need a session. The pieces are tested
// beside the code; these tests pin that each route is wired to them.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { sessionCookieHeader } from "@farmer/core/auth";
import { db } from "@farmer/core/db";
import { session, user } from "@farmer/core/schema/auth";
import { apiTokensService } from "@farmer/core/services";
import { createTestDb, type TestDb } from "@farmer/core/test/harness";

import { Route as deviceRoute } from "#/routes/api/v1/me/devices/$installationId.ts";
import { Route as devicesRoute } from "#/routes/api/v1/me/devices/index.ts";
import { Route as sessionRoute } from "#/routes/api/v1/me/sessions/$id.ts";
import { Route as sessionsRoute } from "#/routes/api/v1/me/sessions/index.ts";

const ME = "u-guards";
const SESSION_TOKEN = "session-token-guards";

type Handler = (args: {
	request: Request;
	params: Record<string, string>;
}) => Promise<Response>;

/** The handler of one method of a server route. */
const handlerOf = (
	route: { options: { server?: { handlers?: object } } },
	method: string,
): Handler => {
	// SAFETY: each handler of an `api/v1` route is made by `apiRoute`,
	// `userApiRoute` or `userWriteRoute`, and all three return a function of
	// `{ request, params }` that answers a Response.
	const handlers = route.options.server?.handlers as
		| Record<string, Handler | undefined>
		| undefined;
	const handler = handlers?.[method];
	if (!handler) throw new Error(`The route has no ${method} handler.`);
	return handler;
};

const call = (
	route: Parameters<typeof handlerOf>[0],
	method: string,
	{
		headers = {},
		params = {},
		body,
	}: {
		headers?: Record<string, string>;
		params?: Record<string, string>;
		body?: object;
	} = {},
) =>
	handlerOf(
		route,
		method,
	)({
		request: new Request("http://localhost/api/v1/test", {
			method,
			headers: { "content-type": "application/json", ...headers },
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
		params,
	});

let harness: TestDb;
let apiToken = "";
let cookie = "";

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** A registration that passes the schema. Its key is not a real P-256 point,
 *  so a call that gets past the session check fails there, with a 422. */
const registration = {
	installationId: "install-guards",
	platform: "ios",
	appVersion: "1.0.0",
	notificationsAllowed: true,
	relayId: "relay-guards-aaaaaaaa",
	publicKey: "A".repeat(86),
	relayProof: "proof",
};

beforeAll(async () => {
	harness = await createTestDb();
	const now = new Date();
	await db.insert(user).values({
		id: ME,
		name: "Guards",
		email: "guards@example.com",
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	});
	await db.insert(session).values({
		id: "s-guards",
		token: SESSION_TOKEN,
		userId: ME,
		expiresAt: new Date(now.getTime() + 24 * 3600 * 1000),
		createdAt: now,
		updatedAt: now,
	});
	cookie = await sessionCookieHeader(SESSION_TOKEN);
	const made = await apiTokensService.create(
		{ organizationId: "", userId: ME },
		{
			name: "Guards",
			scope: "write",
			workspace: "all",
			expiresInDays: null,
		},
	);
	apiToken = made.token;
});

afterAll(async () => {
	await harness.close();
});

describe("a cookie session", () => {
	test("reads the sessions list", async () => {
		const response = await call(sessionsRoute, "GET", {
			headers: { cookie },
		});
		expect(response.status).toBe(200);
	});

	test("is refused on a write route, also from the same site", async () => {
		const response = await call(devicesRoute, "POST", {
			headers: { cookie, "sec-fetch-site": "same-origin" },
			body: registration,
		});
		expect(response.status).toBe(401);
	});

	test("is refused when ending a sign-in", async () => {
		const response = await call(sessionRoute, "DELETE", {
			headers: { cookie },
			params: { id: "s-other" },
		});
		expect(response.status).toBe(401);
	});
});

describe("a personal API token", () => {
	test("is refused on the sessions routes", async () => {
		const list = await call(sessionsRoute, "GET", {
			headers: bearer(apiToken),
		});
		expect(list.status).toBe(403);
		const end = await call(sessionRoute, "DELETE", {
			headers: bearer(apiToken),
			params: { id: "s-guards" },
		});
		expect(end.status).toBe(403);
	});

	test("is refused when it edits or forgets a phone", async () => {
		const patch = await call(deviceRoute, "PATCH", {
			headers: bearer(apiToken),
			params: { installationId: "install-guards" },
			body: { notificationsAllowed: false },
		});
		expect(patch.status).toBe(403);
		const forget = await call(deviceRoute, "DELETE", {
			headers: bearer(apiToken),
			params: { installationId: "install-guards" },
		});
		expect(forget.status).toBe(403);
	});

	test("cannot register a phone", async () => {
		const response = await call(devicesRoute, "POST", {
			headers: bearer(apiToken),
			body: registration,
		});
		expect(response.status).toBe(403);
	});
});

describe("a sign-in session token", () => {
	test("reads the sessions list", async () => {
		const response = await call(sessionsRoute, "GET", {
			headers: bearer(SESSION_TOKEN),
		});
		expect(response.status).toBe(200);
	});

	test("gets past the session check when it registers a phone", async () => {
		const response = await call(devicesRoute, "POST", {
			headers: bearer(SESSION_TOKEN),
			body: registration,
		});
		// 422: the key is refused, which comes after the session check.
		expect(response.status).toBe(422);
	});

	test("may edit a phone", async () => {
		const response = await call(deviceRoute, "DELETE", {
			headers: bearer(SESSION_TOKEN),
			params: { installationId: "install-guards" },
		});
		expect(response.status).not.toBe(403);
	});
});
