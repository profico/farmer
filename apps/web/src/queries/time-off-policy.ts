import { queryOptions } from "@tanstack/react-query";
import {
	getTimeOffPolicy,
	listMemberAllowances,
} from "#/server/time-off-policy.ts";

export const timeOffPolicyQuery = () =>
	queryOptions({
		queryKey: ["time-off-policy"],
		queryFn: () => getTimeOffPolicy(),
	});

export const memberAllowancesQuery = () =>
	queryOptions({
		queryKey: ["time-off-policy", "member-allowances"],
		queryFn: () => listMemberAllowances(),
	});
