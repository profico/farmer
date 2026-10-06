import type { NewOrganization } from "@farmer/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useSession, useSignedIn } from "../session/session";
import { useServerFeatures } from "./capabilities";

// The routes of a person before a workspace: the invitations to them, the
// claims of a Harvest import, and a new workspace. They belong to the
// person, not to a workspace, so each key sits under the key of `useMe`:
// one read of `me` again also reads these. Each route needs API version 3
// and a sign-in session (an API token gets 403).

const MINUTE = 60_000;

const meKey = (origin: string) => ["farmer", origin, "me"] as const;

export const useMyInvitations = () => {
	const { origin, client } = useSignedIn();
	const { setupApi } = useServerFeatures();
	return useQuery({
		queryKey: [...meKey(origin), "invitations"],
		queryFn: () => client.listMyInvitations(),
		enabled: setupApi,
		staleTime: MINUTE,
	});
};

export const useMyImportClaims = () => {
	const { origin, client } = useSignedIn();
	const { setupApi } = useServerFeatures();
	return useQuery({
		queryKey: [...meKey(origin), "import-claims"],
		queryFn: () => client.listMyImportClaims(),
		enabled: setupApi,
		staleTime: MINUTE,
	});
};

/** The number of invitations and claims that wait for an answer. */
export const usePendingCount = () => {
	const invitations = useMyInvitations();
	const claims = useMyImportClaims();
	return (invitations.data?.length ?? 0) + (claims.data?.length ?? 0);
};

/**
 * Opens a workspace that the person just joined or made. `/me` is read
 * again first: the tabs keep the stored workspace only while `/me` lists
 * it, and would otherwise go back to the first workspace of the old list.
 */
export const useEnterWorkspace = () => {
	const { origin } = useSignedIn();
	const { setWorkspace } = useSession();
	const queryClient = useQueryClient();
	return useCallback(
		async (slug: string) => {
			await queryClient.refetchQueries({ queryKey: meKey(origin) });
			await queryClient.invalidateQueries({
				queryKey: ["farmer", origin, slug, "whoami"],
			});
			await setWorkspace(slug);
		},
		[origin, queryClient, setWorkspace],
	);
};

/** Reads the person's lists again after a decline. */
const useRefreshMe = () => {
	const { origin } = useSignedIn();
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey: meKey(origin) });
};

/** Joins a workspace through an invitation. The answer names the
 *  workspace to open. */
export const useAcceptInvitation = () => {
	const { client } = useSignedIn();
	return useMutation({
		mutationFn: (id: string) => client.acceptInvitation(id),
	});
};

export const useDeclineInvitation = () => {
	const { client } = useSignedIn();
	const refresh = useRefreshMe();
	return useMutation({
		mutationFn: (id: string) => client.declineInvitation(id),
		onSuccess: refresh,
	});
};

/** Takes the membership that a Harvest import made. */
export const useAcceptImportClaim = () => {
	const { client } = useSignedIn();
	return useMutation({
		mutationFn: (organizationId: string) =>
			client.acceptImportClaim(organizationId),
	});
};

/** Leaves the workspace that a Harvest import made the person a member
 *  of. The imported history stays with the workspace. */
export const useDeclineImportClaim = () => {
	const { client } = useSignedIn();
	const refresh = useRefreshMe();
	return useMutation({
		mutationFn: (organizationId: string) =>
			client.declineImportClaim(organizationId),
		onSuccess: refresh,
	});
};

/** Makes a workspace that the person owns. Needs `workspaceCreation`. */
export const useCreateWorkspace = () => {
	const { client } = useSignedIn();
	return useMutation({
		mutationFn: (body: NewOrganization) => client.createOrganization(body),
	});
};
