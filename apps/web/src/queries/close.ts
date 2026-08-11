import type { ClosePeriodInput, CloseSheetInput } from "@farmer/core/schema";
import { queryOptions } from "@tanstack/react-query";
import { getCloseSheet, listCloseOverview } from "#/server/close.ts";
import { queryKeys } from "./keys.ts";

export const closeOverviewQuery = (input: ClosePeriodInput) =>
	queryOptions({
		queryKey: [...queryKeys.close, "overview", input.year, input.month],
		queryFn: () => listCloseOverview({ data: input }),
	});

export const closeSheetQuery = (input: CloseSheetInput) =>
	queryOptions({
		queryKey: [
			...queryKeys.close,
			"sheet",
			input.projectId,
			input.year,
			input.month,
		],
		queryFn: () => getCloseSheet({ data: input }),
	});
