import { queryOptions } from "@tanstack/react-query";

import {
	listPlatformAdmins,
	searchPlatformPeople,
} from "#/server/platform-admins.ts";

import { platformKeys } from "./keys.ts";

/** Everybody who operates this deployment. */
export const platformAdminsQuery = () =>
	queryOptions({
		queryKey: platformKeys.admins,
		queryFn: () => listPlatformAdmins(),
	});

/**
 * People matching a search, and nothing at all without one.
 *
 * `enabled` is the page's rule expressed as a query option: an empty or
 * one-letter box must not fetch, because the answer to it would be the
 * instance's user table. The service refuses the same query a second time —
 * this only keeps the request from being made.
 */
export const platformPeopleSearchQuery = (term: string) =>
	queryOptions({
		queryKey: [...platformKeys.people, term],
		queryFn: () => searchPlatformPeople({ data: term }),
		enabled: term.trim().length >= 2,
		// A directory does not change while somebody types into a search box, and
		// every keystroke past the second is a new key.
		staleTime: 30_000,
	});
