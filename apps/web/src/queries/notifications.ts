import { queryOptions } from "@tanstack/react-query";

import { getNotificationSettings } from "#/server/notifications.ts";

import { queryKeys } from "./keys.ts";

export const notificationSettingsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).notificationSettings],
		queryFn: () => getNotificationSettings(),
	});
