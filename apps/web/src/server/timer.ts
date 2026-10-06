import {
	confirmTimerInput,
	startTimerInput,
	timerSettingsInput,
	updateTimerInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgMiddleware } from "./auth";

// The stopwatch (issue #59). `getTimer` is a POST for the reason
// `server/filing-rules.ts` gives: a private, cookie-scoped read must not be
// cacheable, and this one answers a different thing every second.

export const getTimer = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { timersService } = await import("@farmer/core/services");
		return timersService.get(context.ctx);
	});

export const startTimer = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(startTimerInput)
	.handler(async ({ data, context }) => {
		const { timersService } = await import("@farmer/core/services");
		return timersService.start(context.ctx, data);
	});

export const updateTimer = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(updateTimerInput)
	.handler(async ({ data, context }) => {
		const { timersService } = await import("@farmer/core/services");
		return timersService.update(context.ctx, data);
	});

/** Hold the clock. It keeps its figure and measures nothing until `resumeTimer`
 *  starts a new segment, so a pause may last for as long as somebody wants. */
export const pauseTimer = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { timersService } = await import("@farmer/core/services");
		return timersService.pause(context.ctx);
	});

export const resumeTimer = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { timersService } = await import("@farmer/core/services");
		return timersService.resume(context.ctx);
	});

/** Stop and log: one transaction that writes the entry and clears the timer. */
export const confirmTimer = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(confirmTimerInput)
	.handler(async ({ data, context }) => {
		const { timersService } = await import("@farmer/core/services");
		const entry = await timersService.confirm(context.ctx, data);
		const { getPostHogClient } = await import("../lib/posthog-server");
		const posthog = getPostHogClient();
		if (posthog) {
			posthog.capture({
				distinctId: context.ctx.userId,
				event: "timer_confirmed",
				properties: {
					organization_id: context.ctx.organizationId,
					time_entry_id: entry.id,
					has_project: entry.projectId != null,
					duration_seconds: entry.durationSeconds,
				},
			});
			await posthog.flush();
		}
		return entry;
	});

/** Throws the measurement away, and clears the notice a dropped one left. */
export const discardTimer = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { timersService } = await import("@farmer/core/services");
		await timersService.discard(context.ctx);
		return { ok: true };
	});

export const getTimerSettings = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { timersService } = await import("@farmer/core/services");
		return timersService.settings(context.ctx);
	});

export const setTimerSettings = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(timerSettingsInput)
	.handler(async ({ data, context }) => {
		const { timersService } = await import("@farmer/core/services");
		return timersService.setSettings(context.ctx, data);
	});
