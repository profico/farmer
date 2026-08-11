import { queryOptions } from "@tanstack/react-query";
import { getSlackStatus } from "#/server/slack.ts";

export const slackStatusQuery = () =>
	queryOptions({
		queryKey: ["slack", "status"],
		queryFn: () => getSlackStatus(),
	});
