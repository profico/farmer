import { updateIntegrationSettingsInput } from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgMiddleware } from "./auth";

// POST (not GET) so the response is never CDN/browser-cacheable — private,
// cookie-scoped per-user state; see getGithubConnectionStatus for the why.
export const getIntegrationSettings = createServerFn({
	method: "POST",
})
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { integrationSettingsService } = await import(
			"@farmer/core/services"
		);
		return integrationSettingsService.get(context.ctx);
	});

export const updateIntegrationSettings = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(updateIntegrationSettingsInput)
	.handler(async ({ data, context }) => {
		const { integrationSettingsService } = await import(
			"@farmer/core/services"
		);
		const before = await integrationSettingsService.get(context.ctx);
		const after = await integrationSettingsService.update(context.ctx, data);

		// Turning a sync on should DO something. The worker sweeps on an interval,
		// so without this a freshly ticked box looks broken for up to twenty
		// minutes and the obvious conclusion is that it didn't save. Same reasoning
		// as materializing a recurring block the moment its rule is created.
		//
		// This is a user action explicitly asking for the sync, not a page load
		// quietly doing it — the distinction that got the engines out of listRange
		// in the first place.
		//
		// Awaited, but BOUNDED. Awaiting it outright made saving a checkbox as slow
		// as Google and GitHub happen to be that minute, with no ceiling — the
		// request just sat there. The pass is not abandoned when the deadline
		// passes, only stopped being waited on: this is a long-lived process, so it
		// finishes on its own and the next sweep would have covered it regardless.
		//
		// `runAutomationsForUser` catches per engine and never throws, so a revoked
		// token can't fail the save that just succeeded either way.
		const switchedOn =
			(!before.googleAutoSyncMeetings && after.googleAutoSyncMeetings) ||
			(!before.githubSyncCommitsAsWorkTime && after.githubSyncCommitsAsWorkTime);
		if (!switchedOn) return { ...after, synced: false as const };

		const { runAutomationSyncForCtx } = await import("@farmer/core/jobs");
		const { withTimeout } = await import("@farmer/core/lib/http");
		// Short: this is a save, and the person is watching a checkbox, not a sync.
		// Anything slower than this should stop being their problem.
		const synced = await withTimeout(
			runAutomationSyncForCtx(context.ctx).then(() => true),
			5_000,
			() => new Error("still-syncing"),
		).catch(() => false);

		return { ...after, synced };
	});
