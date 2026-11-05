/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { buildOpenApiDocument } from "./openapi.ts";

/**
 * `packages/api-client` makes its types from a copy of this document, and
 * checks its response schemas against them. A copy that is out of date
 * checks against the old API, so this fails until it is made again:
 *
 *   cd packages/api-client && bun run generate
 */
describe("the API client's OpenAPI snapshot", () => {
	test("matches the document the server serves", async () => {
		const snapshot = await Bun.file(
			new URL("../../../../packages/api-client/openapi.json", import.meta.url),
		).json();
		expect(snapshot).toEqual(
			JSON.parse(JSON.stringify(buildOpenApiDocument())),
		);
	});
});
