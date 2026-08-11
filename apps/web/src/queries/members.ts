import { queryOptions } from "@tanstack/react-query";
import {
	getMemberTypeHistory,
	listInvitations,
	listMembers,
	listMemberTypesForMonth,
	listPeople,
} from "#/server/members.ts";

export const membersQuery = () =>
	queryOptions({
		queryKey: ["members"],
		queryFn: () => listMembers(),
	});

export const pendingInvitationsQuery = () =>
	queryOptions({
		queryKey: ["members", "invitations"],
		queryFn: async () => {
			const invitations = await listInvitations();
			return invitations.filter((i) => i.status === "pending");
		},
	});

// The People screen: everyone with their org role, person type and start date.
export const peopleQuery = () =>
	queryOptions({
		queryKey: ["members", "people"],
		queryFn: () => listPeople(),
	});

export const memberTypeHistoryQuery = (userId: string) =>
	queryOptions({
		queryKey: ["members", "type-history", userId],
		queryFn: () => getMemberTypeHistory({ data: userId }),
	});

// Types resolved as of a month — a type change is effective-dated, so "what is
// this person" is only answerable relative to a month.
export const memberTypesForMonthQuery = (year: number, month: number) =>
	queryOptions({
		queryKey: ["members", "types", year, month],
		queryFn: () => listMemberTypesForMonth({ data: { year, month } }),
	});
