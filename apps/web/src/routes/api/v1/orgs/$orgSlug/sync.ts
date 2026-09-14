import type { ApiSyncResult } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/** The same deadline as "Sync now" (`server/google-calendar.ts`). */
const SYNC_TIMEOUT_MS = 25_000;

/**
 * `POST /api/v1/orgs/$orgSlug/sync` — `farmer sync`, the terminal's "Sync now".
 *
 * `runAutomationSyncForCtx`, so a request for a pass already in flight joins
 * it rather than starting a second one — including the sweep's pass for the
 * same person. A CLI in a loop cannot multiply the calls to Google and GitHub
 * that a pass makes, which matters more here than on the button, because a
 * shell loop is easier to write than a held-down mouse.
 *
 * Bounded like the button. Blowing the deadline is not a failure: the pass
 * keeps running in this process, so the answer is `stillRunning: true` with
 * empty lists. An error the pass itself throws is rethrown, or a real failure
 * would read as patience.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/sync")({
	server: {
		handlers: {
			POST: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiSyncResult> => {
					const { runAutomationSyncForCtx } = await import("@farmer/core/jobs");
					const { withTimeout } = await import("@farmer/core/lib/http");

					const outcome = await withTimeout(
						runAutomationSyncForCtx(ctx).then((result) => ({
							timedOut: false as const,
							result,
						})),
						SYNC_TIMEOUT_MS,
						() => new Error("sync-timeout"),
					).catch((error: unknown) => {
						if (error instanceof Error && error.message === "sync-timeout") {
							return { timedOut: true as const };
						}
						throw error;
					});

					if (outcome.timedOut) {
						return {
							stillRunning: true,
							ran: [],
							skipped: [],
							failed: [],
							off: [],
						};
					}
					return {
						stillRunning: false,
						ran: outcome.result.ran,
						skipped: outcome.result.skipped,
						failed: outcome.result.failed,
						off: outcome.result.off,
					};
				},
			}),
		},
	},
});
