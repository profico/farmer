import { queryOptions } from "@tanstack/react-query";
import { getWeeklyTarget, listWorkingHours } from "#/server/working-hours.ts";

export const workingHoursQuery = () =>
	queryOptions({
		queryKey: ["working-hours"],
		queryFn: () => listWorkingHours(),
	});

export const weeklyTargetQuery = () =>
	queryOptions({
		queryKey: ["working-hours", "target"],
		queryFn: () => getWeeklyTarget(),
	});
