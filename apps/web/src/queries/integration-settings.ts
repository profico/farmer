import { queryOptions } from "@tanstack/react-query";
import { getIntegrationSettings } from "#/server/integration-settings.ts";
import { queryKeys } from "./keys.ts";

export const integrationSettingsQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.integrationSettings],
		queryFn: () => getIntegrationSettings(),
	});
