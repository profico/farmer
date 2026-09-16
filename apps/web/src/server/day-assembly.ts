import {
	applyDayAssemblyInput,
	suggestDayAssemblyInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgMiddleware } from "./auth";

export const suggestDayAssembly = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(suggestDayAssemblyInput)
	.handler(async ({ data, context }) => {
		const { dayAssemblyService } = await import("@farmer/core/services");
		return dayAssemblyService.suggest(context.ctx, data);
	});

export const applyDayAssembly = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(applyDayAssemblyInput)
	.handler(async ({ data, context }) => {
		const { dayAssemblyService } = await import("@farmer/core/services");
		const result = await dayAssemblyService.apply(context.ctx, data);
		const { getPostHogClient } = await import("../lib/posthog-server");
		const posthog = getPostHogClient();
		if (posthog) {
			posthog.capture({
				distinctId: context.ctx.userId,
				event: "day_assembly_applied",
				properties: {
					organization_id: context.ctx.organizationId,
				},
			});
			await posthog.flush();
		}
		return result;
	});
