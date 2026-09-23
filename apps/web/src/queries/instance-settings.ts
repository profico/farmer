import { queryOptions } from "@tanstack/react-query";

import {
	getInstanceSettings,
	listInstanceOAuthProviders,
} from "#/server/instance-settings.ts";

import { platformKeys } from "./keys.ts";

/**
 * Every instance setting, resolved and with secrets masked.
 *
 * One query for all five Infrastructure pages rather than one per section: the
 * answer is a few dozen short rows, and a save on one page answers with the
 * whole list anyway (`updateInstanceSettings` returns the view).
 */
export const instanceSettingsQuery = () =>
	queryOptions({
		queryKey: platformKeys.settings,
		queryFn: () => getInstanceSettings(),
	});

/** The OpenID Connect sources, switched on or not. */
export const instanceOAuthProvidersQuery = () =>
	queryOptions({
		queryKey: platformKeys.oauthProviders,
		queryFn: () => listInstanceOAuthProviders(),
	});
