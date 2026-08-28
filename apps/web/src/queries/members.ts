import { queryOptions } from "@tanstack/react-query";

import {
	getMemberTypeHistory,
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
