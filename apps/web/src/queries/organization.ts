import { queryOptions } from "@tanstack/react-query";
import { getOrgSettings } from "#/server/organization.ts";

export const orgSettingsQuery = () =>
	queryOptions({
		queryKey: ["organization", "settings"],
		queryFn: () => getOrgSettings(),
	});
