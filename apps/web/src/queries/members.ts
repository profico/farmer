import { queryOptions } from "@tanstack/react-query";
import { listInvitations, listMembers } from "#/server/members.ts";

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
