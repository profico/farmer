import { queryOptions } from "@tanstack/react-query";

import {
	getAppReach,
	getNotificationSettings,
} from "#/server/notifications.ts";

import { queryKeys } from "./keys.ts";

export const notificationSettingsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).notificationSettings],
		queryFn: () => getNotificationSettings(),
	});

export const appReachQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).appReach],
		queryFn: () => getAppReach(),
	});
