import type { FarmerClient, StartTimer } from "@farmer/api-client";
import {
	type QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

import { useSignedIn } from "../session/session";
import { afterTimeChange } from "./invalidation";

const MINUTE = 60_000;

export type Workspace = { origin: string; client: FarmerClient; slug: string };

/** The signed-in session with its workspace. The tab screens render only
 *  once a workspace is chosen (see `app/(tabs)/_layout.tsx`). */
export const useWorkspace = (): Workspace => {
	const { origin, client, workspace } = useSignedIn();
	if (!workspace) throw new Error("No workspace is chosen yet.");
	return { origin, client, slug: workspace };
};

/**
 * The key every query of the workspace starts with: the Server address and
 * the workspace slug. Tenancy is part of the key, so two workspaces never
 * share a cache entry.
 */
export const scope = (w: Workspace) => ["farmer", w.origin, w.slug] as const;

/**
 * The keys that a change of time makes stale: the days, the reports, the
 * hours on the project list, and the timer. A timer that continues an entry
 * reads its project, task and note live from the entry (#133).
 */
export const refreshTime = (queryClient: QueryClient, w: Workspace) =>
	afterTimeChange(queryClient, scope(w));

export const useMe = () => {
	const { origin, client } = useSignedIn();
	return useQuery({
		queryKey: ["farmer", origin, "me"],
		queryFn: () => client.me(),
		staleTime: 5 * MINUTE,
	});
};

export const useWhoami = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: [...scope(w), "whoami"],
		queryFn: () => w.client.whoami(w.slug),
		staleTime: 5 * MINUTE,
	});
};

export const useProjects = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: [...scope(w), "projects"],
		queryFn: () => w.client.projects(w.slug),
		staleTime: 5 * MINUTE,
	});
};

export const useTasks = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: [...scope(w), "tasks"],
		queryFn: () => w.client.tasks(w.slug),
		staleTime: 5 * MINUTE,
	});
};

export const useTracking = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: [...scope(w), "tracking"],
		queryFn: () => w.client.tracking(w.slug),
		staleTime: MINUTE,
	});
};

/**
 * The entries of a range. The server's read recomputes the fill blocks of
 * the days it covers, so it is a write: it is asked once a minute at most,
 * and never again only because the app came back to the front.
 */
export const useEntries = (from: string, to: string) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: [...scope(w), "entries", from, to],
		queryFn: () => w.client.timeEntries(w.slug, from, to),
		staleTime: MINUTE,
		refetchOnWindowFocus: false,
	});
};

export const useUnfiled = (from: string, to: string) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: [...scope(w), "unfiled", from, to],
		queryFn: () => w.client.unfiled(w.slug, from, to),
		staleTime: MINUTE,
		refetchOnWindowFocus: false,
	});
};

/**
 * The person's timer, which may run in another workspace. Read again when
 * the app comes to the front, because the web or the CLI may have stopped
 * it, and once a minute while one runs. `fresh` reads the timer again on
 * mount, whatever its age: the Stop screen needs the entry's live note,
 * which another client may have edited.
 */
export const useTimer = ({ fresh = false }: { fresh?: boolean } = {}) => {
	const w = useWorkspace();
	return useQuery({
		refetchOnMount: fresh ? "always" : true,
		queryKey: [...scope(w), "timer"],
		queryFn: () => w.client.timer(w.slug),
		staleTime: 15_000,
		refetchInterval: (query) => (query.state.data?.timer ? MINUTE : false),
	});
};

type TimerAction = "pause" | "resume" | "discard";

/** Start, pause, resume and discard all answer the new timer state, which
 *  replaces the cached one. */
export const useTimerAction = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (action: TimerAction) => {
			switch (action) {
				case "pause":
					return w.client.pauseTimer(w.slug);
				case "resume":
					return w.client.resumeTimer(w.slug);
				case "discard":
					return w.client.discardTimer(w.slug);
			}
		},
		onSuccess: (state) => {
			queryClient.setQueryData([...scope(w), "timer"], state);
		},
	});
};

/** The key of every timer start in the app. The push bridge reads the
 *  mutation cache for it, to ask for the notification permission. */
export const START_TIMER_KEY = ["farmer", "timer", "start"] as const;

export const useStartTimer = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationKey: START_TIMER_KEY,
		mutationFn: (body: StartTimer) => w.client.startTimer(w.slug, body),
		onSuccess: (state) => {
			queryClient.setQueryData([...scope(w), "timer"], state);
		},
	});
};
