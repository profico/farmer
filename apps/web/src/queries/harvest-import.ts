import { queryOptions } from "@tanstack/react-query";

import { listHarvestRuns } from "#/server/harvest-import.ts";

import { queryKeys } from "./keys.ts";

// The runs list on Settings → Import. The snapshot is deliberately not a
// query: it is read once per import, right before the plan is built, and a
// cached one would plan against rows an earlier run has since changed.
export const harvestRunsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).harvestImport, "runs"],
		queryFn: () => listHarvestRuns(),
	});
