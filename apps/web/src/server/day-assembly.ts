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
		return dayAssemblyService.apply(context.ctx, data);
	});
