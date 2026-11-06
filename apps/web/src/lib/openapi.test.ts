/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { buildOpenApiDocument, OPERATIONS } from "./openapi.ts";

const V1 = join(import.meta.dir, "../routes/api/v1");

/** The web app's own cookie-authed reads, and the document itself. */
const UNDOCUMENTED = new Set([
	"projects.ts",
	"time-entries.ts",
	"openapi[.]json.ts",
]);

/** `orgs/$orgSlug/time-entries/index.ts` → `/orgs/{orgSlug}/time-entries`. */
const pathOf = (file: string) =>
	`/${file}`
		.replace(/\.ts$/, "")
		.replace(/\/index$/, "")
		.replace(/\$(\w+)/g, "{$1}");

/** Every `METHOD path` the route files under `api/v1` answer. */
const routeOperations = async () => {
	const found: string[] = [];
	for (const entry of await readdir(V1, { recursive: true })) {
		if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
		const file = relative(V1, join(V1, entry));
		if (UNDOCUMENTED.has(file)) continue;
		const source = await Bun.file(join(V1, file)).text();
		for (const [, method] of source.matchAll(/\b(GET|POST|PATCH|DELETE):/g)) {
			found.push(`${method} ${pathOf(file)}`);
		}
	}
	return found.sort();
};

describe("the OpenAPI document", () => {
	test("documents every route under api/v1, and nothing else", async () => {
		const documented = OPERATIONS.map(
			(op) => `${op.method.toUpperCase()} ${op.path}`,
		).sort();
		expect(documented).toEqual(await routeOperations());
	});

	test("resolves every schema reference", () => {
		const document = buildOpenApiDocument();
		const json = JSON.stringify(document);
		const refs = [...json.matchAll(/"#\/components\/schemas\/(\w+)"/g)].map(
			([, id]) => id,
		);
		expect(refs.length).toBeGreaterThan(0);
		const schemas = Object.keys(document.components.schemas);
		for (const id of refs) expect(schemas).toContain(id);
	});

	test("leaves the route's id out of a PATCH body", () => {
		const { TimeEntryPatch } = buildOpenApiDocument().components.schemas;
		expect(Object.keys(TimeEntryPatch?.properties ?? {})).not.toContain(
			"timeEntryId",
		);
		expect(TimeEntryPatch?.required).toBeUndefined();
	});

	// A route takes these ids from its path and overwrites a value in the
	// body, so a body that lists them would tell a client to send them.
	test("leaves the path's ids out of every body", () => {
		const { schemas } = buildOpenApiDocument().components;
		const cases = [
			["ClientPatch", ["clientId"]],
			["ProjectPatch", ["projectId"]],
			["NewProjectMember", ["projectId"]],
			["ProjectMemberRole", ["projectId", "userId"]],
			["TaskPatch", ["taskId"]],
			["PersonRole", ["userId"]],
			["TeamLeadPeople", ["leadUserId"]],
		] as const;
		for (const [id, fields] of cases) {
			const properties = Object.keys(schemas[id]?.properties ?? {});
			expect(properties.length).toBeGreaterThan(0);
			for (const field of fields) {
				expect(properties).not.toContain(field);
				expect(schemas[id]?.required ?? []).not.toContain(field);
			}
		}
		expect(schemas.ProjectMemberRole?.required).toContain("role");
	});

	// A route that only some people may call says who, and documents its 403.
	test("names who may call a restricted read", () => {
		const document = buildOpenApiDocument();
		const people = document.paths["/orgs/{orgSlug}/people"]?.get;
		expect(people?.description).toContain("**Who:** An admin.");
		expect(Object.keys(people?.responses ?? {})).toContain("403");
		const entries = document.paths["/orgs/{orgSlug}/time-entries"]?.get;
		expect(Object.keys(entries?.responses ?? {})).not.toContain("403");
	});

	// The mobile app reads these before it shows a screen. A field that falls out
	// of the document falls out of the generated client with it.
	test("documents the mobile contract in Meta and Whoami", () => {
		const { Meta, Whoami } = buildOpenApiDocument().components.schemas;
		expect(Object.keys(Meta?.properties ?? {})).toEqual(
			expect.arrayContaining([
				"apiVersion",
				"serverVersion",
				"minMobileVersion",
				"signInMethods",
				"passwordSignIn",
				"pushRelay",
			]),
		);
		expect(Whoami?.required).toContain("capabilities");
	});

	// A secret goes out only in the answers that make one: a new webhook
	// endpoint, a rolled secret and a new API token. A field named
	// like a secret on any other response is a leak waiting for a client. A
	// request body may carry one: that is how a key goes in.
	test("puts a secret only in the answers that make one", () => {
		const document = buildOpenApiDocument();
		const responses = JSON.stringify(
			Object.values(document.paths).flatMap((methods) =>
				Object.values(methods).map((op) => op.responses["200"]),
			),
		);
		const answered = new Set(
			[...responses.matchAll(/"#\/components\/schemas\/(\w+)"/g)].map(
				([, id]) => id,
			),
		);
		const withSecret = Object.entries(document.components.schemas)
			.filter(
				([id, schema]) =>
					answered.has(id) &&
					Object.keys(schema.properties ?? {}).some((field) =>
						/secret$|token$|apikey$|password$/i.test(field),
					),
			)
			.map(([id]) => id)
			.sort();
		expect(withSecret).toEqual([
			"PersonalTokenCreated",
			"WebhookEndpointCreated",
			"WebhookSecret",
		]);
	});

	test("documents the assistant's turn as a stream of events", () => {
		const { paths } = buildOpenApiDocument();
		for (const path of [
			"/orgs/{orgSlug}/assistant/threads/{id}/messages",
			"/orgs/{orgSlug}/assistant/threads/{id}/approvals",
		]) {
			expect(paths[path]?.post?.responses["200"]?.content).toEqual({
				"text/event-stream": {
					schema: { $ref: "#/components/schemas/AssistantEvent" },
				},
			});
		}
	});
});
