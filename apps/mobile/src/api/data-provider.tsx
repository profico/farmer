import { isSignedOut } from "@farmer/api-client";
import {
	focusManager,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { AppState } from "react-native";

import { useSession } from "../session/session";

const makeQueryClient = () =>
	new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				retry: (failures, error) => failures < 2 && !isSignedOut(error),
			},
		},
	});

/**
 * The query cache, emptied when the session ends. A refused token anywhere
 * signs the person out here, as the CLI drops its token on a 401.
 */
export function DataProvider({ children }: { children: ReactNode }) {
	const { state, forget } = useSession();
	const [queryClient] = useState(makeQueryClient);

	useEffect(() => {
		const stopQueries = queryClient.getQueryCache().subscribe((event) => {
			if (
				event.type === "updated" &&
				event.action.type === "error" &&
				isSignedOut(event.action.error)
			) {
				void forget();
			}
		});
		const stopMutations = queryClient.getMutationCache().subscribe((event) => {
			if (
				event.type === "updated" &&
				event.action.type === "error" &&
				isSignedOut(event.action.error)
			) {
				void forget();
			}
		});
		return () => {
			stopQueries();
			stopMutations();
		};
	}, [queryClient, forget]);

	// React Native has no window focus. The app coming to the front is the
	// same event, so the queries that ask for it read again then.
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (status) => {
			focusManager.setFocused(status === "active");
		});
		return () => subscription.remove();
	}, []);

	const signedIn = state.status === "signed_in";
	useEffect(() => {
		if (!signedIn) queryClient.clear();
	}, [signedIn, queryClient]);

	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
