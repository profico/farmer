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
});
