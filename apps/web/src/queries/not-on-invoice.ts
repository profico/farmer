import type { NotOnInvoiceReportInput } from "@farmer/core/schema";
import { queryOptions } from "@tanstack/react-query";
import {
	getNotOnInvoiceReport,
	listNotOnInvoiceStatusOptions,
} from "#/server/not-on-invoice.ts";

export const notOnInvoiceReportQuery = (input: NotOnInvoiceReportInput) =>
	queryOptions({
		queryKey: ["not-on-invoice", "report", input.year, input.month],
		queryFn: () => getNotOnInvoiceReport({ data: input }),
	});

export const notOnInvoiceStatusOptionsQuery = () =>
	queryOptions({
		queryKey: ["not-on-invoice", "status-options"],
		queryFn: () => listNotOnInvoiceStatusOptions(),
	});
