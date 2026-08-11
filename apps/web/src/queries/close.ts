import type { ClosePeriodInput, CloseSheetInput } from "@farmer/core/schema";
import { queryOptions } from "@tanstack/react-query";
import { getCloseSheet, listCloseOverview } from "#/server/close.ts";

export const closeOverviewQuery = (input: ClosePeriodInput) =>
	queryOptions({
		queryKey: ["close", "overview", input.year, input.month],
		queryFn: () => listCloseOverview({ data: input }),
	});

export const closeSheetQuery = (input: CloseSheetInput) =>
	queryOptions({
		queryKey: ["close", "sheet", input.projectId, input.year, input.month],
		queryFn: () => getCloseSheet({ data: input }),
	});
