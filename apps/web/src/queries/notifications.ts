import { queryOptions } from "@tanstack/react-query";
import { getNotificationSettings } from "#/server/notifications.ts";
import { queryKeys } from "./keys.ts";

export const notificationSettingsQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.notificationSettings],
		queryFn: () => getNotificationSettings(),
	});
