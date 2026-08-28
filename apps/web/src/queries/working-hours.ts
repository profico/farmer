import { queryOptions } from "@tanstack/react-query";

import { getWeeklyTarget, listWorkingHours } from "#/server/working-hours.ts";

import { queryKeys } from "./keys.ts";

export const workingHoursQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).workingHours],
		queryFn: () => listWorkingHours(),
	});

export const weeklyTargetQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).workingHours, "target"],
		queryFn: () => getWeeklyTarget(),
	});
