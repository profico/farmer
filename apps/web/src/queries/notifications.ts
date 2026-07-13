import { queryOptions } from "@tanstack/react-query";
import { getNotificationSettings } from "#/server/notifications.ts";

export const notificationSettingsQuery = () =>
	queryOptions({
		queryKey: ["notification-settings"],
		queryFn: () => getNotificationSettings(),
	});
