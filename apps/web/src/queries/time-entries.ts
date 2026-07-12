import { queryOptions } from "@tanstack/react-query";
import { listTimeEntriesRange } from "#/server/time-entries.ts";

export const timeEntriesRangeQuery = (from: string, to: string) =>
	queryOptions({
		queryKey: ["time-entries", from, to],
		queryFn: () => listTimeEntriesRange({ data: { from, to } }),
	});
