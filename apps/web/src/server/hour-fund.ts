import {
	hourFundYearInput,
	monthPeriodInput,
	setMonthlyHourFundInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgAdminMiddleware } from "./auth";

// The monthly hour fund is the denominator of Expected for every non-contractor,
// so it's Admin-owned. Reads are admin-only too: it only ever appears on the
// Settings screen that edits it.

export const listHourFundsForYear = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(hourFundYearInput)
	.handler(async ({ data, context }) => {
		const { hourFundService } = await import("@farmer/core/services");

		return hourFundService.listForYear(context.ctx, data.year);
	});

export const setMonthlyHourFund = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(setMonthlyHourFundInput)
	.handler(async ({ data, context }) => {
		const { hourFundService } = await import("@farmer/core/services");

		return hourFundService.set(context.ctx, data);
	});

// Clearing is its own call rather than `set` with a null: `fundSeconds` is a
// number in the input schema because zero is a legitimate fund, so "no fund"
// can't ride in on the same field.
export const clearMonthlyHourFund = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(monthPeriodInput)
	.handler(async ({ data, context }) => {
		const { hourFundService } = await import("@farmer/core/services");

		return hourFundService.clear(context.ctx, data.year, data.month);
	});

// What the official working calendar implies for a month, offered as a default
// the admin can accept or overtype. Never written automatically — a wrong fund
// silently skews every Expected figure in the org.
export const suggestMonthlyHourFund = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(monthPeriodInput)
	.handler(async ({ data, context }) => {
		const { hourFundService } = await import("@farmer/core/services");

		return hourFundService.suggestForMonth(context.ctx, data.year, data.month);
	});

export const prefillHourFundYear = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(hourFundYearInput)
	.handler(async ({ data, context }) => {
		const { hourFundService } = await import("@farmer/core/services");

		return hourFundService.prefillYear(context.ctx, data.year);
	});
