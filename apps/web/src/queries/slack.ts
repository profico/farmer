import { queryOptions } from "@tanstack/react-query";
import { getSlackStatus } from "#/server/slack.ts";
import { queryKeys } from "./keys.ts";

export const slackStatusQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).slack, "status"],
		queryFn: () => getSlackStatus(),
	});
