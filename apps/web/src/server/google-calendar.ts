import { listCalendarEventsInput } from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgMiddleware } from "./auth";

// POST (not GET) so the response is never CDN/browser-cacheable — private,
// cookie-scoped per-user state; see getGithubConnectionStatus for the why.
export const getGoogleCalendarStatus = createServerFn({
	method: "POST",
})
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { googleCalendarService } = await import("@farmer/core/services");
		return googleCalendarService.connectionStatus(context.ctx);
	});

export const listCalendarEventsForDay = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(listCalendarEventsInput)
	.handler(async ({ data, context }) => {
		const { googleCalendarService } = await import("@farmer/core/services");
		return googleCalendarService.listEventsForDay(context.ctx, data);
	});

// Manual "Sync now" — reconciles this user's meetings across the same window
// the background scheduler uses. A no-op if Google isn't connected (the sync
// engine bails when it can't read the calendar), so it's safe to expose behind
// the connected-only UI.
export const syncGoogleMeetings = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { syncMeetingsForCtx } = await import("@farmer/core/jobs");
		await syncMeetingsForCtx(context.ctx);
		return { ok: true };
	});
