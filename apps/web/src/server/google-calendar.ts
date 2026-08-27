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

// Manual "Sync now" — runs this user's whole automation pass (recurring blocks,
// meetings, commit work-time blocks) over the same window the scheduled sweep
// uses, so the button and the timer can never produce different results. It
// covers more than the calendar because there is one thing to ask for: "catch
// me up now", rather than a button per engine.
//
// Each engine no-ops when its switch is off or its account isn't connected, so
// this is safe to expose from any of the integration cards.
// Bounded, because the work behind it is other people's servers. Every outbound
// call now carries its own deadline (core/lib/http), so this is the belt to that
// pair of braces: whatever happens underneath, the button gets an answer and the
// request does not sit open holding a connection. Blowing the deadline is not a
// failure — the pass keeps running in this process and finishes on its own, so
// the honest report is "started, still going".
const SYNC_NOW_TIMEOUT_MS = 25_000;

export const syncGoogleMeetings = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { runAutomationSyncForCtx } = await import("@farmer/core/jobs");
		const { withTimeout } = await import("@farmer/core/lib/http");

		// Only the deadline turns into "still going". An error thrown by the pass
		// itself is rethrown, or a real failure would read as patience.
		const outcome = await withTimeout(
			runAutomationSyncForCtx(context.ctx).then((result) => ({
				timedOut: false as const,
				result,
			})),
			SYNC_NOW_TIMEOUT_MS,
			() => new Error("sync-now-timeout"),
		).catch((error: unknown) => {
			if (error instanceof Error && error.message === "sync-now-timeout") {
				return { timedOut: true as const };
			}
			throw error;
		});

		if (outcome.timedOut) {
			return {
				ok: true,
				stillRunning: true,
				ran: [] as string[],
				skipped: [] as string[],
				failed: [] as string[],
				off: [] as string[],
			};
		}
		return {
			ok: outcome.result.failed.length === 0,
			stillRunning: false,
			...outcome.result,
		};
	});
