import { queryOptions } from "@tanstack/react-query";
import { getSlackStatus } from "#/server/slack.ts";
import { queryKeys } from "./keys.ts";

export const slackStatusQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.slack, "status"],
		queryFn: () => getSlackStatus(),
	});
