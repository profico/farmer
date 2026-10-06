import type { NewPersonalToken } from "@farmer/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSignedIn } from "../session/session";
import { useServerFeatures } from "./capabilities";
import { scope, useWorkspace } from "./queries";

// The queries and the writes of Signed-in devices and API tokens. Both
// belong to the person, so the sessions key has the Server and no workspace.
// The tokens route has a workspace in its path, because a new token can bind
// to it, so that key starts with `scope(w)`. Each query waits for API
// version 4, because a link can open a screen past the gate in Preferences.

const MINUTE = 60_000;

export const useSessions = () => {
	const { origin, client } = useSignedIn();
	const { accountApi } = useServerFeatures();
	return useQuery({
		queryKey: ["farmer", origin, "sessions"],
		queryFn: () => client.listSessions(),
		enabled: accountApi,
		staleTime: MINUTE,
	});
};

/** Signs out another device. The session of this phone is not revoked here:
 *  that is signing out, which `useSession().signOut` does. */
export const useRevokeSession = () => {
	const { origin, client } = useSignedIn();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => client.revokeSession(id),
		// `revoked: false` is a session that ended already. The list is read
		// again either way, so the row goes.
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: ["farmer", origin, "sessions"],
			}),
	});
};

const tokensKey = (w: ReturnType<typeof useWorkspace>) =>
	[...scope(w), "you", "api-tokens"] as const;

export const useApiTokens = () => {
	const w = useWorkspace();
	const { accountApi } = useServerFeatures();
	return useQuery({
		queryKey: tokensKey(w),
		queryFn: () => w.client.listApiTokens(w.slug),
		enabled: accountApi,
		staleTime: MINUTE,
	});
};

/**
 * Makes a token. The token is only in the answer. The screen keeps it in its
 * own state and resets the mutation at once, so it stays out of the mutation
 * cache. Only the row (without the token) goes to the list.
 */
export const useCreateApiToken = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: NewPersonalToken) =>
			w.client.createApiToken(w.slug, body),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensKey(w) }),
	});
};

export const useRevokeApiToken = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => w.client.revokeApiToken(w.slug, id),
		onSettled: () => queryClient.invalidateQueries({ queryKey: tokensKey(w) }),
	});
};
