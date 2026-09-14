import { sessionIdInput } from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgMiddleware, sessionMiddleware } from "./auth";

// Preferences → Signed-in devices.
//
// Both middlewares, on purpose. `orgMiddleware` gives the membership-checked
// Ctx every service takes; `sessionMiddleware` gives the session this request
// was made with, which is the only way to know which row is "This device" and
// which one the service must refuse to revoke. Neither alone carries both, and
// `server/auth.ts` has no middleware that does. The cost is one extra session
// lookup on a settings screen, which is not a path anybody walks in a loop.

export const listMySessions = createServerFn({ method: "GET" })
	.middleware([orgMiddleware, sessionMiddleware])
	.handler(async ({ context }) => {
		const { sessionsService } = await import("@farmer/core/services");
		return sessionsService.listMine(context.ctx, context.session.session.id);
	});

export const revokeMySession = createServerFn({ method: "POST" })
	.middleware([orgMiddleware, sessionMiddleware])
	.validator(sessionIdInput)
	.handler(async ({ data: sessionId, context }) => {
		const { sessionsService } = await import("@farmer/core/services");
		return sessionsService.revoke(
			context.ctx,
			sessionId,
			context.session.session.id,
		);
	});
