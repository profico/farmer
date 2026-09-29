import type { AuditFilterInput } from "@farmer/core/schema";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { getAuditRetention, listAuditEvents } from "#/server/audit.ts";

import { queryKeys } from "./keys.ts";

/** The log, a page at a time, newest first. The filter is part of the key, so
 *  each filter keeps its own pages. */
export const auditEventsQuery = (org: string, filter: AuditFilterInput) =>
	infiniteQueryOptions({
		queryKey: [...queryKeys(org).audit, "events", filter],
		queryFn: ({ pageParam }) =>
			listAuditEvents({ data: { ...filter, cursor: pageParam || undefined } }),
		// The first page has no cursor. An empty string rather than null, so the
		// page parameter stays one type.
		initialPageParam: "",
		getNextPageParam: (page) => page.nextCursor,
	});

export const auditRetentionQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).audit, "retention"],
		queryFn: () => getAuditRetention(),
	});
