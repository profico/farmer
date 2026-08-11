import { queryOptions } from "@tanstack/react-query";
import { getWeeklyTarget, listWorkingHours } from "#/server/working-hours.ts";
import { queryKeys } from "./keys.ts";

export const workingHoursQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.workingHours],
		queryFn: () => listWorkingHours(),
	});

export const weeklyTargetQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.workingHours, "target"],
		queryFn: () => getWeeklyTarget(),
	});
