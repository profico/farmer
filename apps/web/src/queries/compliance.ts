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

// In the TIME-ENTRIES family, not the compliance one the service belongs to:
// the figure is a function of the caller's own entries, and every one of the
// thirteen places that saves an entry already marks that family stale. Keyed
// under compliance it went stale on the very screen the entry was saved on —
// "3:30" in the week strip beside "2,00" in the targets above it — until a
// reload. Fund, holiday and tolerance edits are settings-page rarities; those
// refetch on the next open.
export const myTargetsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).timeEntries, "my-targets"],
		queryFn: () => getMyTargets(),
	});
