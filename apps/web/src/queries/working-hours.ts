import { queryOptions } from "@tanstack/react-query";

import { listWorkingHours } from "#/server/working-hours.ts";

import { queryKeys } from "./keys.ts";

export const workingHoursQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).workingHours],
		queryFn: () => listWorkingHours(),
	});
