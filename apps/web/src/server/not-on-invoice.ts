import {
	createStatusOptionInput,
	notOnInvoiceReportInput,
	setNotOnInvoiceStatusInput,
	statusOptionIdInput,
	updateStatusOptionInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgAdminMiddleware } from "./auth";

// "Who did we not invoice this month, and why" — an org-wide financial
// question, so Admin-only throughout.

export const getNotOnInvoiceReport = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(notOnInvoiceReportInput)
	.handler(async ({ data, context }) => {
		const { notOnInvoiceService } = await import("@farmer/core/services");
		return notOnInvoiceService.report(context.ctx, data);
	});

export const setNotOnInvoiceStatus = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(setNotOnInvoiceStatusInput)
	.handler(async ({ data, context }) => {
		const { notOnInvoiceService } = await import("@farmer/core/services");
		return notOnInvoiceService.setStatus(context.ctx, data);
	});

export const listNotOnInvoiceStatusOptions = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { notOnInvoiceService } = await import("@farmer/core/services");
		return notOnInvoiceService.listStatusOptions(context.ctx);
	});

export const createNotOnInvoiceStatusOption = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(createStatusOptionInput)
	.handler(async ({ data, context }) => {
		const { notOnInvoiceService } = await import("@farmer/core/services");
		return notOnInvoiceService.createStatusOption(context.ctx, data);
	});

export const updateNotOnInvoiceStatusOption = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(updateStatusOptionInput)
	.handler(async ({ data, context }) => {
		const { notOnInvoiceService } = await import("@farmer/core/services");
		return notOnInvoiceService.updateStatusOption(context.ctx, data);
	});

export const archiveNotOnInvoiceStatusOption = createServerFn({
	method: "POST",
})
	.middleware([orgAdminMiddleware])
	.validator(statusOptionIdInput)
	.handler(async ({ data: statusOptionId, context }) => {
		const { notOnInvoiceService } = await import("@farmer/core/services");
		return notOnInvoiceService.archiveStatusOption(context.ctx, statusOptionId);
	});
