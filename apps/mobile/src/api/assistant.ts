import type {
	AssistantConnect,
	AssistantSettingsPatch,
	AssistantThread,
} from "@farmer/api-client";
import {
	type QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

import { useAccess } from "./capabilities";
import { scope, useWorkspace, type Workspace } from "./queries";

/**
 * The queries and the changes of the assistant: the threads, one thread,
 * the models and the settings. The settings query itself is
 * `useAssistantSettings` in `capabilities.ts`, because the menu reads it.
 */

export const assistantKey = (w: Workspace) =>
	[...scope(w), "assistant"] as const;
export const threadsKey = (w: Workspace) =>
	[...assistantKey(w), "threads"] as const;
export const threadKey = (w: Workspace, id: string) =>
	[...assistantKey(w), "thread", id] as const;
const settingsKey = (w: Workspace) => [...assistantKey(w), "settings"] as const;

export const useAssistantThreads = () => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: threadsKey(w),
		queryFn: () => w.client.listAssistantThreads(w.slug),
		enabled: fullApi,
	});
};

export const useAssistantThread = (id: string) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: threadKey(w, id),
		queryFn: () => w.client.getAssistantThread(w.slug, id),
	});
};

/** The models of the provider. Only an admin may list them. */
export const useAssistantModels = (enabled: boolean) => {
	const w = useWorkspace();
	return useQuery({
		queryKey: [...assistantKey(w), "models"],
		queryFn: () => w.client.listAssistantModels(w.slug),
		enabled,
		staleTime: 10 * 60_000,
	});
};

const putThread = (
	queryClient: QueryClient,
	w: Workspace,
	thread: AssistantThread,
) =>
	queryClient.setQueryData<AssistantThread[]>(threadsKey(w), (current) =>
		current
			? [thread, ...current.filter((row) => row.id !== thread.id)]
			: [thread],
	);

export const useCreateThread = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => w.client.createAssistantThread(w.slug, {}),
		onSuccess: (thread) => putThread(queryClient, w, thread),
	});
};

export const useRenameThread = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, title }: { id: string; title: string }) =>
			w.client.renameAssistantThread(w.slug, id, { title }),
		onSuccess: (thread) => {
			queryClient.setQueryData<AssistantThread[]>(threadsKey(w), (current) =>
				current?.map((row) => (row.id === thread.id ? thread : row)),
			);
			void queryClient.invalidateQueries({ queryKey: threadKey(w, thread.id) });
		},
	});
};

export const useDeleteThread = () => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => w.client.deleteAssistantThread(w.slug, id),
		onSuccess: (_, id) => {
			queryClient.setQueryData<AssistantThread[]>(threadsKey(w), (current) =>
				current?.filter((row) => row.id !== id),
			);
			queryClient.removeQueries({ queryKey: threadKey(w, id) });
		},
	});
};

/** A change of the settings puts the answer in the cache, so the menu and
 *  the chat read the new state at once. */
const useSettingsChange = <Input>(
	change: (
		w: Workspace,
		input: Input,
	) => ReturnType<Workspace["client"]["getAssistantSettings"]>,
) => {
	const w = useWorkspace();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: Input) => change(w, input),
		onSuccess: (settings) => {
			queryClient.setQueryData(settingsKey(w), settings);
		},
	});
};

export const useConnectAssistant = () =>
	useSettingsChange((w, body: AssistantConnect) =>
		w.client.connectAssistant(w.slug, body),
	);

export const useUpdateAssistantSettings = () =>
	useSettingsChange((w, body: AssistantSettingsPatch) =>
		w.client.updateAssistantSettings(w.slug, body),
	);

export const useDisconnectAssistant = () =>
	useSettingsChange<void>((w) => w.client.disconnectAssistant(w.slug));
