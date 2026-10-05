import type {
	NewProject,
	ProjectDetail,
	ProjectMemberRole,
	ProjectPatch,
} from "@farmer/api-client";
import {
	type QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

import { useAccess } from "./capabilities";
import { scope, type Workspace, useWorkspace } from "./queries";

/**
 * The queries of the project screens: the list with its figures, one
 * project, its overview and its team. All of them need API version 2, so
 * they wait for `fullApi`. A query that only a lead may read also waits
 * for the access of the screen (`enabled`), so a member gets no refusal.
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
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: listKey(w),
		queryFn: () => w.client.listProjects(w.slug),
		enabled: fullApi,
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
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: [...projectKey(w, id), "overview"],
		queryFn: () => w.client.getProjectOverview(w.slug, id),
		enabled: fullApi && enabled,
		staleTime: MINUTE,
	});
};

export const useProjectMembers = (id: string, enabled: boolean) => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: [...projectKey(w, id), "members"],
		queryFn: () => w.client.listProjectMembers(w.slug, id),
		enabled: fullApi && enabled,
		staleTime: MINUTE,
	});
};

export const useAssignable = (id: string, enabled: boolean) => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: [...projectKey(w, id), "assignable"],
		queryFn: () => w.client.listAssignable(w.slug, id),
		enabled: fullApi && enabled,
		staleTime: MINUTE,
	});
};

/** The active clients, for the client of a project. */
export const useClients = (enabled = true) => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: [...scope(w), "clients"],
		queryFn: () => w.client.listClients(w.slug),
		enabled: fullApi && enabled,
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
