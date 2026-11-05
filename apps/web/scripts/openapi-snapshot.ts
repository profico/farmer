/// <reference types="bun-types" />
/**
 * Writes the plain `/api/v1` OpenAPI document (the one
 * `GET /api/v1/openapi.json` serves) to a file.
 *
 * `packages/api-client` keeps a copy and makes its TypeScript types from it
 * (`bun run generate` there). The script lives here, and not in the client,
 * because the client must not import the web app (see `oxlint.config.ts`).
 *
 *   bun run scripts/openapi-snapshot.ts <output.json>
 */

import { buildOpenApiDocument } from "../src/lib/openapi.ts";

const output = process.argv[2];
if (!output) {
	console.error("Usage: bun run scripts/openapi-snapshot.ts <output.json>");
	process.exit(2);
}
await Bun.write(
	output,
	`${JSON.stringify(buildOpenApiDocument(), null, "\t")}\n`,
);
console.log(`Wrote ${output}`);
