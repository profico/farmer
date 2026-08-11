import { z } from "zod";

const year = z.number().int().min(2000).max(2100);
const month = z.number().int().min(1).max(12);

export const notOnInvoiceReportInput = z.object({ year, month });
export type NotOnInvoiceReportInput = z.infer<typeof notOnInvoiceReportInput>;

export const setNotOnInvoiceStatusInput = z.object({
	year,
	month,
	userId: z.string().min(1),
	statusOptionId: z.uuid().nullable(),
	comment: z.string().max(2000).nullable().optional(),
});
export type SetNotOnInvoiceStatusInput = z.infer<
	typeof setNotOnInvoiceStatusInput
>;

export const createStatusOptionInput = z.object({
	label: z.string().trim().min(1, "Label is required").max(60),
	sortOrder: z.number().int().min(0).max(999).optional(),
});
export type CreateStatusOptionInput = z.infer<typeof createStatusOptionInput>;

export const updateStatusOptionInput = z.object({
	statusOptionId: z.uuid(),
	label: z.string().trim().min(1).max(60).optional(),
	sortOrder: z.number().int().min(0).max(999).optional(),
});
export type UpdateStatusOptionInput = z.infer<typeof updateStatusOptionInput>;

export const statusOptionIdInput = z.uuid();
export type StatusOptionIdInput = z.infer<typeof statusOptionIdInput>;
