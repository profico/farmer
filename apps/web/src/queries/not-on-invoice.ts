import type { NotOnInvoiceReportInput } from "@farmer/core/schema";
import { queryOptions } from "@tanstack/react-query";

import {
	getNotOnInvoiceReport,
	listNotOnInvoiceStatusOptions,
} from "#/server/not-on-invoice.ts";

import { queryKeys } from "./keys.ts";

export const notOnInvoiceReportQuery = (
	org: string,
	input: NotOnInvoiceReportInput,
) =>
	queryOptions({
		queryKey: [
			...queryKeys(org).notOnInvoice,
			"report",
			input.year,
			input.month,
		],
		queryFn: () => getNotOnInvoiceReport({ data: input }),
	});

export const notOnInvoiceStatusOptionsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).notOnInvoice, "status-options"],
		queryFn: () => listNotOnInvoiceStatusOptions(),
	});
