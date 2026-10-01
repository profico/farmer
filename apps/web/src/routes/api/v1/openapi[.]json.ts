import { createFileRoute } from "@tanstack/react-router";

import { buildOpenApiDocument } from "#/lib/openapi.ts";

/** Built on the first request. It depends on nothing but the code. */
let document: ReturnType<typeof buildOpenApiDocument> | null = null;

/** What `slugify` can produce. Anything else is ignored, not echoed. */
const SLUG = /^[a-z0-9-]{1,64}$/;

/**
 * `GET /api/v1/openapi.json` — the OpenAPI document that `/api-docs` renders.
 *
 * No credential and no rate limit, like `meta`: it reads no database and says
 * nothing about anybody. It answers even when `CLI_ENABLED=false`, because it
 * describes the API rather than calling it.
 *
 * `?org=<slug>` puts that slug in as the example of every `orgSlug` parameter
 * (see `buildOpenApiDocument`). The slug comes from the query, not from a
 * session, so the answer is still the same for everyone who asks for it.
 */
export const Route = createFileRoute("/api/v1/openapi.json")({
	server: {
		handlers: {
			GET: ({ request }) => {
				const org = new URL(request.url).searchParams.get("org");
				// Not cached: a slug is anything a caller types, and a map keyed on
				// it would grow without bound. Building takes about a millisecond.
				const answer =
					org && SLUG.test(org)
						? buildOpenApiDocument({ orgSlug: org })
						: (document ??= buildOpenApiDocument());
				return Response.json(answer, {
					headers: { "Cache-Control": "public, max-age=300" },
				});
			},
		},
	},
});
