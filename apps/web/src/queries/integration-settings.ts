import { queryOptions } from "@tanstack/react-query";
import { getIntegrationSettings } from "#/server/integration-settings.ts";

export const integrationSettingsQuery = () =>
	queryOptions({
		queryKey: ["integration-settings"],
		queryFn: () => getIntegrationSettings(),
	});
