import { queryOptions } from "@tanstack/react-query";

import {
	getMemberTypeHistory,
	listDirectory,
	listInvitations,
	listMembers,
	listMemberTypesForMonth,
	listPeople,
} from "#/server/members.ts";

import { queryKeys } from "./keys.ts";

export const membersQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).members],
		queryFn: () => listMembers(),
	});

export const pendingInvitationsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).members, "invitations"],
		queryFn: async () => {
			const invitations = await listInvitations();

			return invitations.filter((i) => i.status === "pending");
		},
		// Polls only while an email is in flight. Its status changes a few
		// seconds after the invitation is created, and nothing else would tell
		// this list; the server turns a "sending" that never finished into
		// "failed", so this cannot poll forever.
		refetchInterval: (query) =>
			query.state.data?.some((i) => i.emailDelivery?.status === "sending")
				? 3_000
				: false,
	});

// Names and faces for the whole org, read by every avatar on every screen (see
// `components/person-avatar.tsx`). Warmed by the `/$orgSlug` layout so the
// photos are there on the first paint rather than fading in a beat later; the
// long staleTime is because a photo changes when somebody changes it at Google,
// which is roughly never and is picked up at their next sign-in anyway.
export const directoryQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).members, "directory"],
		queryFn: () => listDirectory(),
		staleTime: 30 * 60_000,
	});

// The People screen: everyone with their org role, person type and start date.
export const peopleQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).members, "people"],
		queryFn: () => listPeople(),
	});

export const memberTypeHistoryQuery = (org: string, userId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).members, "type-history", userId],
		queryFn: () => getMemberTypeHistory({ data: userId }),
	});

// Types resolved as of a month — a type change is effective-dated, so "what is
// this person" is only answerable relative to a month.
export const memberTypesForMonthQuery = (
	org: string,
	year: number,
	month: number,
) =>
	queryOptions({
		queryKey: [...queryKeys(org).members, "types", year, month],
		queryFn: () => listMemberTypesForMonth({ data: { year, month } }),
	});
