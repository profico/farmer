import type {
	AvailableRepositories,
	AvailableRepository,
	NewProject,
	ProjectDetail,
	ProjectMemberRole,
	ProjectPatch,
	ProjectRepository,
} from "@farmer/api-client";
import {
	type QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

import { scope, type Workspace, useWorkspace } from "./queries";

/**
 * The queries of the project screens: the list with its figures, one
 * project, its overview and its team. A query that only a lead may read
 * waits for the access of the screen (`enabled`), so a member gets no
 * refusal.
 */
const MINUTE = 60_000;

/** Under the key of `useProjects`, so that one invalidation of
 *  `projects` also reads the pickers again. Its own entry, because the
 *  shape is not the same. */
const listKey = (w: Workspace) => [...scope(w), "projects", "list"] as const;
const projectKey = (w: Workspace, id: string) =>
	[...scope(w), "projects", "one", id] as const;

/** Every project that the person may open, with this month's hours. An
 *  admin gets every project, archived ones too. */
export const useProjectList = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: listKey(w),
		queryFn: () => w.client.listProjects(w.slug),
		staleTime: MINUTE,
	});
};

/**
 * One project, from the list. The list holds an archived project too, and
 * one read of the list serves every project screen.
 */
export const useProject = (id: string) => {
	const list = useProjectList();
	const project: ProjectDetail | undefined = list.data?.find(
		(row) => row.id === id,
	);
	return { ...list, project };
};

export const useProjectOverview = (id: string, enabled: boolean) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: [...projectKey(w, id), "overview"],
		queryFn: () => w.client.getProjectOverview(w.slug, id),
		enabled: enabled,
		staleTime: MINUTE,
	});
};

export const useProjectMembers = (id: string, enabled: boolean) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: [...projectKey(w, id), "members"],
		queryFn: () => w.client.listProjectMembers(w.slug, id),
		enabled: enabled,
		staleTime: MINUTE,
	});
};

export const useAssignable = (id: string, enabled: boolean) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: [...projectKey(w, id), "assignable"],
		queryFn: () => w.client.listAssignable(w.slug, id),
		enabled: enabled,
		staleTime: MINUTE,
	});
};

/** The active clients, for the client of a project. */
export const useActiveClients = (enabled = true) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: [...scope(w), "clients"],
		queryFn: () => w.client.listClients(w.slug),
		enabled: enabled,
		staleTime: 5 * MINUTE,
	});
};

/** A change to a project changes the lists, the pickers, `whoami` (its
 *  projects) and the reports. */
const invalidateProjects = (queryClient: QueryClient, w: Workspace) =>
	Promise.all([
		queryClient.invalidateQueries({ queryKey: [...scope(w), "projects"] }),
		queryClient.invalidateQueries({ queryKey: [...scope(w), "whoami"] }),
		queryClient.invalidateQueries({ queryKey: [...scope(w), "reports"] }),
	]);

export const useCreateProject = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: NewProject) => w.client.createProject(w.slug, body),
		onSuccess: () => invalidateProjects(queryClient, w),
	});
};

export const useUpdateProject = (id: string) => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: ProjectPatch) =>
			w.client.updateProject(w.slug, id, body),
		onSuccess: () => invalidateProjects(queryClient, w),
	});
};

/** Archive (`true`) or restore (`false`) a project. */
export const useArchiveProject = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
			archive
				? w.client.archiveProject(w.slug, id)
				: w.client.restoreProject(w.slug, id),
		onSuccess: () => invalidateProjects(queryClient, w),
	});
};

export type TeamChange =
	| { kind: "add"; userId: string; role: ProjectMemberRole["role"] }
	| { kind: "role"; userId: string; role: ProjectMemberRole["role"] }
	| { kind: "remove"; userId: string };

/** Add a person, change a role or remove a person. Each call answers the
 *  new team, which replaces the cached one. */
export const useChangeTeam = (id: string) => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (change: TeamChange) => {
			switch (change.kind) {
				case "add":
					return w.client.addProjectMember(w.slug, id, {
						userId: change.userId,
						role: change.role,
					});
				case "role":
					return w.client.changeProjectRole(w.slug, id, change.userId, {
						role: change.role,
					});
				case "remove":
					return w.client.removeProjectMember(w.slug, id, change.userId);
			}
		},
		onSuccess: async (members) => {
			queryClient.setQueryData([...projectKey(w, id), "members"], members);
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: [...projectKey(w, id), "assignable"],
				}),
				invalidateProjects(queryClient, w),
			]);
		},
	});
};

// The GitHub repositories of a project. Admin only.

const repositoriesKey = (w: Workspace, id: string) =>
	[...projectKey(w, id), "repositories"] as const;

/** Under the key of the GitHub screen of the workspace, so that a change
 *  of the installations there reads this list again too. */
const availableKey = (w: Workspace) =>
	[...scope(w), "admin", "github", "repositories"] as const;

export const useProjectRepositories = (id: string, enabled: boolean) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: repositoriesKey(w, id),
		queryFn: () => w.client.listProjectRepositories(w.slug, id),
		enabled: enabled,
		staleTime: MINUTE,
	});
};

/**
 * Each repository that the GitHub installations of the workspace can read,
 * with the project that holds it. The server keeps the list for a few
 * minutes. Each read without the cache is a call to GitHub for each
 * installation, so a link or an unlink changes the cached list by hand.
 */
export const useAvailableRepositories = (enabled: boolean) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: availableKey(w),
		queryFn: () => w.client.listAvailableRepositories(w.slug),
		enabled: enabled,
		staleTime: 5 * MINUTE,
	});
};

/** Writes the project that holds a repository into the cached list. */
const setHolder = (
	queryClient: QueryClient,
	w: Workspace,
	githubRepoId: number,
	linkedTo: AvailableRepository["linkedTo"],
) =>
	queryClient.setQueryData<AvailableRepositories>(
		availableKey(w),
		(list) =>
			list && {
				...list,
				repositories: list.repositories.map((repo) =>
					repo.githubRepoId === githubRepoId ? { ...repo, linkedTo } : repo,
				),
			},
	);

/**
 * Links a repository to the project. The answer is every repository of the
 * project. A refusal usually means that the cached list was old about the
 * project that holds the repository, so then the list is read again.
 */
export const useLinkRepository = (id: string, projectName: string) => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (repo: AvailableRepository) =>
			w.client.linkProjectRepository(w.slug, id, {
				githubRepoId: repo.githubRepoId,
				installationId: repo.installationId,
			}),
		// A read already in flight would land without this link.
		onMutate: () => queryClient.cancelQueries({ queryKey: availableKey(w) }),
		onSuccess: (rows, repo) => {
			queryClient.setQueryData(repositoriesKey(w, id), rows);
			setHolder(queryClient, w, repo.githubRepoId, {
				projectId: id,
				projectName,
			});
		},
		onError: () => queryClient.invalidateQueries({ queryKey: availableKey(w) }),
	});
};

/** Unlinks a repository. The commits already on entries stay. */
export const useUnlinkRepository = (id: string) => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (link: ProjectRepository) =>
			w.client.unlinkProjectRepository(w.slug, id, link.id),
		onSuccess: (rows, link) => {
			queryClient.setQueryData(repositoriesKey(w, id), rows);
			setHolder(queryClient, w, link.githubRepoId, null);
		},
		onError: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: repositoriesKey(w, id) }),
				queryClient.invalidateQueries({ queryKey: availableKey(w) }),
			]),
	});
};

/**
 * Reads the repositories from GitHub again, past the cache of the server,
 * for a repository made after the last read. The screen does not offer it
 * while a link is in flight: the answer would not hold that link yet.
 */
export const useRefreshRepositories = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => w.client.refreshAvailableRepositories(w.slug),
		onMutate: () => queryClient.cancelQueries({ queryKey: availableKey(w) }),
		onSuccess: (fresh) => {
			queryClient.setQueryData(availableKey(w), fresh);
		},
	});
};
