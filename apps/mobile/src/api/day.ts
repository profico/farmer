import type {
	ApplyDayAssembly,
	AttachCommits,
	AttachPullRequests,
	TimeEntry,
} from "@farmer/api-client";
import {
	type QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

import { useAccess } from "./capabilities";
import { refreshTime, scope, useWorkspace, type Workspace } from "./queries";

/**
 * The helpers of the day, from API version 3: "Assemble my day", the
 * meetings of the person's calendar, the calendar notice on an entry, and
 * the GitHub commits and pull requests on an entry. Each read waits for
 * `dayApi`, so an older Server gets no request.
 */

const MINUTE = 60_000;

const githubKey = (w: Workspace) => [...scope(w), "github"] as const;

const attachedCommitsKey = (w: Workspace, id: string) =>
	[...githubKey(w), "attached-commits", id] as const;

const attachedPullRequestsKey = (w: Workspace, id: string) =>
	[...githubKey(w), "attached-pull-requests", id] as const;

/** The suggestions of a day. They come from the calendar, GitHub and what
 *  is logged now, so each opening of the sheet reads them again. */
export const useDayAssembly = (date: string, includeDismissed: boolean) => {
	const w = useWorkspace();
	const { dayApi } = useAccess();
	return useQuery({
		queryKey: [...scope(w), "day-assembly", date, includeDismissed],
		queryFn: () =>
			w.client.suggestDayAssembly(w.slug, { date, includeDismissed }),
		enabled: dayApi,
		staleTime: 0,
	});
};

export const useApplyDayAssembly = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: ApplyDayAssembly) =>
			w.client.applyDayAssembly(w.slug, body),
		onSettled: () =>
			Promise.all([
				refreshTime(queryClient, w),
				queryClient.invalidateQueries({
					queryKey: [...scope(w), "day-assembly"],
				}),
			]),
	});
};

/** The timed meetings of a day in the person's Google Calendar. */
export const useCalendarEvents = (date: string, enabled: boolean) => {
	const w = useWorkspace();
	const { dayApi } = useAccess();
	return useQuery({
		queryKey: [...scope(w), "calendar", "events", date],
		queryFn: () => w.client.listCalendarEvents(w.slug, { date }),
		enabled: dayApi && enabled,
		staleTime: MINUTE,
	});
};

/** Puts the entry that a calendar answer gives into the cached weeks. */
const putEntry = (queryClient: QueryClient, w: Workspace, entry: TimeEntry) =>
	queryClient.setQueriesData<TimeEntry[]>(
		{ queryKey: [...scope(w), "entries"] },
		(old) => old?.map((row) => (row.id === entry.id ? entry : row)),
	);

/** Keep the entry as the person changed it, and clear the notice. */
export const useDismissCalendarChange = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => w.client.dismissCalendarChange(w.slug, id),
		onSuccess: (entry) => putEntry(queryClient, w, entry),
		onSettled: () => refreshTime(queryClient, w),
	});
};

/** Take the calendar's day and length. The entry follows the calendar
 *  again. */
export const useTakeCalendarValues = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => w.client.useCalendarValues(w.slug, id),
		onSuccess: (entry) => putEntry(queryClient, w, entry),
		onSettled: () => refreshTime(queryClient, w),
	});
};

/** The GitHub repositories linked to a project. A member who may log time
 *  on the project may read them. */
export const useProjectRepositories = (
	projectId: string | null,
	enabled: boolean,
) => {
	const w = useWorkspace();
	const { dayApi } = useAccess();
	return useQuery({
		queryKey: [...githubKey(w), "project-repos", projectId],
		queryFn: () => w.client.listProjectRepositories(w.slug, projectId ?? ""),
		enabled: dayApi && enabled && projectId !== null,
		staleTime: 5 * MINUTE,
	});
};

/** The person's commits of a day in the project's repositories. */
export const useSuggestedCommits = (
	projectId: string | null,
	date: string,
	enabled: boolean,
) => {
	const w = useWorkspace();
	const { dayApi } = useAccess();
	return useQuery({
		queryKey: [...githubKey(w), "suggested-commits", projectId, date],
		queryFn: () =>
			w.client.suggestCommits(w.slug, { projectId: projectId ?? "", date }),
		enabled: dayApi && enabled && projectId !== null,
		staleTime: MINUTE,
	});
};

/** The pull requests the person worked on that day. */
export const useSuggestedPullRequests = (
	projectId: string | null,
	date: string,
	enabled: boolean,
) => {
	const w = useWorkspace();
	const { dayApi } = useAccess();
	return useQuery({
		queryKey: [...githubKey(w), "suggested-pull-requests", projectId, date],
		queryFn: () =>
			w.client.suggestPullRequests(w.slug, {
				projectId: projectId ?? "",
				date,
			}),
		enabled: dayApi && enabled && projectId !== null,
		staleTime: MINUTE,
	});
};

export const useAttachedCommits = (id: string | null) => {
	const w = useWorkspace();
	const { dayApi } = useAccess();
	return useQuery({
		queryKey: attachedCommitsKey(w, id ?? ""),
		queryFn: () => w.client.listAttachedCommits(w.slug, id ?? ""),
		enabled: dayApi && id !== null,
	});
};

export const useAttachedPullRequests = (id: string | null) => {
	const w = useWorkspace();
	const { dayApi } = useAccess();
	return useQuery({
		queryKey: attachedPullRequestsKey(w, id ?? ""),
		queryFn: () => w.client.listAttachedPullRequests(w.slug, id ?? ""),
		enabled: dayApi && id !== null,
	});
};

/**
 * Attaches the picked commits and pull requests to a saved entry. The
 * entry exists already, so a failure here does not undo the save: the
 * caller tells the person what did not attach.
 */
export const useAttachActivity = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({
			id,
			commits,
			pullRequests,
		}: {
			id: string;
			commits: AttachCommits["commits"];
			pullRequests: AttachPullRequests["pullRequests"];
		}) => {
			if (commits.length > 0) {
				const attached = await w.client.attachCommits(w.slug, id, {
					commits,
				});
				queryClient.setQueryData(attachedCommitsKey(w, id), attached);
			}
			if (pullRequests.length > 0) {
				const attached = await w.client.attachPullRequests(w.slug, id, {
					pullRequests,
				});
				queryClient.setQueryData(attachedPullRequestsKey(w, id), attached);
			}
		},
		onSettled: () => refreshTime(queryClient, w),
	});
};

/** Removes one commit from an entry. The answer is the commits that stay. */
export const useDetachCommit = (id: string) => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (commitId: string) =>
			w.client.detachCommit(w.slug, id, commitId),
		onSuccess: (attached) =>
			queryClient.setQueryData(attachedCommitsKey(w, id), attached),
		onSettled: () => refreshTime(queryClient, w),
	});
};

/** Removes every event of one pull request from an entry, one after the
 *  other. The last answer is the events that stay. */
export const useDetachPullRequest = (id: string) => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (activityIds: string[]) => {
			for (const activityId of activityIds) {
				const attached = await w.client.detachPullRequest(
					w.slug,
					id,
					activityId,
				);
				queryClient.setQueryData(attachedPullRequestsKey(w, id), attached);
			}
		},
		onSettled: () =>
			Promise.all([
				refreshTime(queryClient, w),
				queryClient.invalidateQueries({
					queryKey: attachedPullRequestsKey(w, id),
				}),
			]),
	});
};
