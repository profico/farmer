import { queryOptions } from "@tanstack/react-query";
import { getIntegrationSettings } from "#/server/integration-settings.ts";
import { queryKeys } from "./keys.ts";

export const integrationSettingsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).integrationSettings],
		queryFn: () => getIntegrationSettings(),
	});
