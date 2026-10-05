import { useQuery } from "@tanstack/react-query";

import { useAccess } from "../api/capabilities";
import { scope, useWorkspace } from "../api/queries";
import type { TimeTab } from "./csv";

/**
 * The reads of the Reports tab and of a project's page. The server limits
 * each report to what the person may see: an admin sees everybody, a PM
 * their projects, a Team Lead their people and projects, and a member
 * only their own time. Nothing here filters again.
 */
const MINUTE = 60_000;

export type Range = { from: string; to: string };

/** The filters of the entries behind a figure. A filter that is not set
 *  is not sent. */
export type DetailFilters = Range & {
	clientId?: string;
	projectId?: string;
	taskId?: string;
	userId?: string;
	activeOnly?: boolean;
};

/** `activeOnly` goes only as `true`: a missing flag is the default. */
const flag = (value: boolean | undefined) => (value ? true : undefined);

export const useTimeReport = (
	range: Range,
	tab: TimeTab,
	activeOnly: boolean,
) => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: [...scope(w), "reports", "time", range, tab, activeOnly],
		queryFn: () =>
			w.client.getTimeReport(w.slug, {
				...range,
				tab,
				activeOnly: flag(activeOnly),
			}),
		enabled: fullApi && range.from !== "",
		staleTime: MINUTE,
	});
};

export const useTimeDetail = (filters: DetailFilters, enabled = true) => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: [...scope(w), "reports", "detail", filters],
		queryFn: () =>
			w.client.getTimeReportDetail(w.slug, {
				...filters,
				activeOnly: flag(filters.activeOnly),
			}),
		enabled: fullApi && enabled && filters.from !== "",
		staleTime: MINUTE,
	});
};

export const useOvertimeReport = (range: Range, activeOnly: boolean) => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: [...scope(w), "reports", "overtime", range, activeOnly],
		queryFn: () =>
			w.client.getOvertimeReport(w.slug, {
				...range,
				activeOnly: flag(activeOnly),
			}),
		enabled: fullApi && range.from !== "",
		staleTime: MINUTE,
		placeholderData: (previous) => previous,
	});
};

export const useAbsenceReport = (range: Range) => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: [...scope(w), "reports", "absence", range],
		queryFn: () => w.client.getAbsenceReport(w.slug, range),
		enabled: fullApi && range.from !== "",
		staleTime: MINUTE,
		placeholderData: (previous) => previous,
	});
};
