import {
	setWeeklyTargetInput,
	upsertWorkingHoursDayInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgMiddleware } from "./auth";

export const listWorkingHours = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { workingHoursService } = await import("@farmer/core/services");
		return workingHoursService.list(context.ctx);
	});

export const upsertWorkingHoursDay = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(upsertWorkingHoursDayInput)
	.handler(async ({ data, context }) => {
		const { workingHoursService } = await import("@farmer/core/services");
		return workingHoursService.upsertDay(context.ctx, data);
	});

export const getWeeklyTarget = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { workingHoursService } = await import("@farmer/core/services");
		return workingHoursService.getWeeklyTarget(context.ctx);
	});

export const setWeeklyTarget = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(setWeeklyTargetInput)
	.handler(async ({ data, context }) => {
		const { workingHoursService } = await import("@farmer/core/services");
		return workingHoursService.setWeeklyTarget(context.ctx, data);
	});
