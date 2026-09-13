import { queryOptions } from "@tanstack/react-query";

import { getMyTargets, getTrackingReport } from "#/server/compliance.ts";

import { queryKeys } from "./keys.ts";

export const trackingReportQuery = (
	org: string,
	input: { year: number; month: number },
) =>
	queryOptions({
		queryKey: [
			...queryKeys(org).compliance,
			"tracking",
			input.year,
			input.month,
		],
		queryFn: () => getTrackingReport({ data: input }),
	});

export const myTargetsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).compliance, "my-targets"],
		queryFn: () => getMyTargets(),
	});
