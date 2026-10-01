import {
	exportAuditEventsInput,
	listAuditEventsInput,
	setAuditRetentionInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgAdminMiddleware } from "./auth";

// The Audit log page. Admin only, at the middleware AND in the service: the
// log names who signed in from where, and what every admin changed.

export const listAuditEvents = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(listAuditEventsInput)
	.handler(async ({ data, context }) => {
		const { auditService } = await import("@farmer/core/services");
		return auditService.list(context.ctx, data);
	});

/** A POST, not a GET: the export records itself in the log. */
export const exportAuditEvents = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(exportAuditEventsInput)
	.handler(async ({ data, context }) => {
		const { auditService } = await import("@farmer/core/services");
		return auditService.exportCsv(context.ctx, data);
	});

export const getAuditRetention = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { auditService } = await import("@farmer/core/services");
		return auditService.retention(context.ctx);
	});

export const setAuditRetention = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(setAuditRetentionInput)
	.handler(async ({ data, context }) => {
		const { auditService } = await import("@farmer/core/services");
		return auditService.setRetention(context.ctx, data.days);
	});
