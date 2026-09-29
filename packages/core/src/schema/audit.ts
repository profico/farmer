import { z } from "zod";

import {
	AUDIT_CATEGORIES,
	AUDIT_KIND_NAMES,
	AUDIT_RETENTION_DAYS,
} from "../lib/audit";
import { dayKeySchema } from "./day-key";

// The inputs of the Audit log page.

/** Rows on one page of the log. */
export const AUDIT_PAGE_SIZE = 50;

/** The most rows one CSV export holds. An export of a busy year is a job, not
 *  a request, and nobody reads a spreadsheet longer than this. */
export const MAX_AUDIT_EXPORT_ROWS = 10_000;

/** The widest range one export may cover, in days. */
export const MAX_AUDIT_EXPORT_DAYS = 366;

export const auditFilterInput = z.object({
	category: z.enum(AUDIT_CATEGORIES).optional(),
	kind: z.enum(AUDIT_KIND_NAMES).optional(),
	/** The person who did it, or the person it happened to. */
	userId: z.string().min(1).max(64).optional(),
	/** yyyy-MM-dd, in the organization's timezone, inclusive. */
	from: dayKeySchema.optional(),
	to: dayKeySchema.optional(),
});
export type AuditFilterInput = z.infer<typeof auditFilterInput>;

export const listAuditEventsInput = auditFilterInput.extend({
	/** The `cursor` of the previous page. Opaque to the caller. */
	cursor: z.string().max(128).optional(),
});
export type ListAuditEventsInput = z.infer<typeof listAuditEventsInput>;

export const exportAuditEventsInput = auditFilterInput.extend({
	from: dayKeySchema,
	to: dayKeySchema,
});
export type ExportAuditEventsInput = z.infer<typeof exportAuditEventsInput>;

export const setAuditRetentionInput = z.object({
	days: z.literal(AUDIT_RETENTION_DAYS),
});
export type SetAuditRetentionInput = z.infer<typeof setAuditRetentionInput>;
