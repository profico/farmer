import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { sessionMiddleware } from "./auth";

// The MCP consent screen's read (`routes/mcp-consent.tsx`).
//
// Only a read: the decision itself goes to better-auth's `/oauth2/consent`,
// which the page posts to directly. What comes back is for the signed-in
// person's own pending request and nobody else's — a code that is theirs
// answers, anything else is null (`consentRequestFor` in
// `packages/core/src/auth/mcp-consent.ts`).

/** better-auth's consent codes are 32 characters; the ceiling is headroom. */
const consentCodeInput = z.object({ consentCode: z.string().min(1).max(256) });

export const getMcpConsentRequest = createServerFn({ method: "GET" })
	.middleware([sessionMiddleware])
	.validator(consentCodeInput)
	.handler(async ({ data, context }) => {
		const { mcpConsentRequest } = await import("@farmer/core/auth");
		return mcpConsentRequest(context.session.user.id, data.consentCode);
	});
