import {
	listHolidaysForRangeInput,
	listHolidaysForYearInput,
	setHolidayDisabledInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgAdminMiddleware, orgMiddleware } from "./auth";

export const listSupportedCountries = createServerFn({
	method: "GET",
})
	.middleware([orgMiddleware])
	.handler(async () => {
		const { holidaysService } = await import("@farmer/core/services");
		return holidaysService.listSupportedCountries();
	});

export const listHolidaysForYearWithStatus = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(listHolidaysForYearInput)
	.handler(async ({ data: year, context }) => {
		const { holidaysService } = await import("@farmer/core/services");
		return holidaysService.listForYearWithStatus(context.ctx, year);
	});

export const setHolidayDisabled = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(setHolidayDisabledInput)
	.handler(async ({ data, context }) => {
		const { holidaysService } = await import("@farmer/core/services");
		await holidaysService.setHolidayDisabled(context.ctx, data);
	});

export const listHolidaysForRange = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(listHolidaysForRangeInput)
	.handler(async ({ data: range, context }) => {
		const { holidaysService } = await import("@farmer/core/services");
		const byDate = await holidaysService.holidaySetForRange(
			context.ctx,
			range.from,
			range.to,
		);
		return Array.from(byDate.entries());
	});
