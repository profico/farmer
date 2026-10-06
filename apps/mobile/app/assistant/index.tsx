import type { AssistantThread } from "@farmer/api-client";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import {
	ActionSheetIOS,
	Alert,
	FlatList,
	Platform,
	RefreshControl,
	View,
} from "react-native";

import {
	useAssistantThreads,
	useCreateThread,
	useDeleteThread,
	useRenameThread,
} from "../../src/api/assistant";
import { AssistantGate, useAssistantReady } from "../../src/assistant/gate";
import { RenameDialog } from "../../src/assistant/rename-dialog";
import { useThreadRunning } from "../../src/assistant/runs";
import {
	ActionButton,
	EmptyState,
	ErrorBanner,
	ErrorState,
	IconButton,
	ListRow,
	Skeleton,
} from "../../src/ui/components";
import { LoadingIndicator } from "../../src/ui/loading";
import { Inset, usePullToRefresh } from "../../src/ui/screen";
import { usePalette } from "../../src/ui/theme";
import { SPACE } from "../../src/ui/type";

const DAY_MS = 24 * 60 * 60_000;

/** "Today, 14:05", "Yesterday" or "3 Oct", in the phone's own words. */
const whenOf = (iso: string, now: number) => {
	const at = new Date(iso);
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	if (at.getTime() >= today.getTime()) {
		return at.toLocaleTimeString(undefined, {
			hour: "2-digit",
			minute: "2-digit",
		});
	}
	if (at.getTime() >= today.getTime() - DAY_MS) return "Yesterday";
	return at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

function ThreadRow({
	thread,
	now,
	onOpen,
	onActions,
}: {
	thread: AssistantThread;
	/** The time the list was opened, for the "Today" and "Yesterday" words. */
	now: number;
	onOpen: () => void;
	onActions: () => void;
}) {
	const palette = usePalette();
	const running = useThreadRunning(thread.id);
	return (
		<ListRow
			icon="assistant"
			title={thread.title}
			subtitle={running ? "Working" : whenOf(thread.updatedAt, now)}
			onPress={onOpen}
			trailing={
				<View style={{ flexDirection: "row", alignItems: "center" }}>
					{running ? (
						<LoadingIndicator size={24} color={palette.primary} />
					) : null}
					<IconButton
						icon="edit"
						label={`Rename or delete ${thread.title}`}
						onPress={onActions}
					/>
				</View>
			}
		/>
	);
}

/**
 * The person's conversations with the assistant, newest first. A row opens
 * the conversation. Its button renames or deletes it.
 */
export default function AssistantThreadsScreen() {
	const router = useRouter();
	const palette = usePalette();
	const threads = useAssistantThreads();
	const create = useCreateThread();
	const ready = useAssistantReady();
	const rename = useRenameThread();
	const remove = useDeleteThread();
	const [renaming, setRenaming] = useState<AssistantThread | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [now] = useState(Date.now);
	const pull = usePullToRefresh(
		threads.isRefetching,
		() => void threads.refetch(),
	);

	const start = () => {
		setError(null);
		create.mutate(undefined, {
			onSuccess: (thread) =>
				router.push({
					pathname: "/assistant/[id]",
					params: { id: thread.id },
				}),
			onError: (failure) => setError(failure.message),
		});
	};

	const confirmDelete = (thread: AssistantThread) =>
		Alert.alert(
			"Delete the conversation?",
			`"${thread.title}" and its messages go. This cannot be undone.`,
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Delete",
					style: "destructive",
					onPress: () =>
						remove.mutate(thread.id, {
							onError: (failure) => setError(failure.message),
						}),
				},
			],
		);

	const actionsFor = (thread: AssistantThread) => {
		if (Platform.OS === "ios") {
			ActionSheetIOS.showActionSheetWithOptions(
				{
					title: thread.title,
					options: ["Rename", "Delete", "Cancel"],
					destructiveButtonIndex: 1,
					cancelButtonIndex: 2,
				},
				(index) => {
					if (index === 0) setRenaming(thread);
					if (index === 1) confirmDelete(thread);
				},
			);
			return;
		}
		Alert.alert(thread.title, undefined, [
			{ text: "Cancel", style: "cancel" },
			{
				text: "Delete",
				style: "destructive",
				onPress: () => confirmDelete(thread),
			},
			{ text: "Rename", onPress: () => setRenaming(thread) },
		]);
	};

	return (
		<>
			<Stack.Screen
				options={{
					title: "Assistant",
					// No new conversation while the gate below says why the
					// assistant cannot answer.
					headerRight: ready
						? () => (
								<IconButton
									icon="add"
									label="New conversation"
									onPress={start}
									disabled={create.isPending}
								/>
							)
						: () => null,
				}}
			/>
			<AssistantGate>
				<FlatList
					data={threads.data ?? []}
					keyExtractor={(thread) => thread.id}
					contentInsetAdjustmentBehavior="automatic"
					refreshControl={
						<RefreshControl
							refreshing={pull.refreshing}
							onRefresh={pull.onRefresh}
							colors={[String(palette.primary)]}
							progressBackgroundColor={String(palette.surfaceContainerHigh)}
							tintColor={palette.primary}
						/>
					}
					ListHeaderComponent={
						error ? (
							<View style={{ padding: SPACE.l }}>
								<ErrorBanner message={error} />
							</View>
						) : null
					}
					ListEmptyComponent={
						threads.isPending ? (
							<View style={{ paddingTop: SPACE.l }}>
								<Inset>
									<Skeleton height={56} />
									<Skeleton height={56} />
									<Skeleton height={56} />
								</Inset>
							</View>
						) : threads.error ? (
							<ErrorState
								error={threads.error}
								onRetry={() => void threads.refetch()}
							/>
						) : (
							<EmptyState
								icon="assistant"
								title="No conversations yet"
								message="Ask about your tracked time, or ask the assistant to log more of it. It shows you every change first."
								action={
									<ActionButton
										label="Start a conversation"
										onPress={start}
										disabled={create.isPending}
									/>
								}
							/>
						)
					}
					renderItem={({ item }) => (
						<ThreadRow
							thread={item}
							now={now}
							onOpen={() =>
								router.push({
									pathname: "/assistant/[id]",
									params: { id: item.id },
								})
							}
							onActions={() => actionsFor(item)}
						/>
					)}
				/>
			</AssistantGate>
			<RenameDialog
				// A new key gives each rename a fresh field.
				key={renaming?.id ?? "closed"}
				initial={renaming?.title ?? null}
				onCancel={() => setRenaming(null)}
				onSave={async (title) => {
					if (!renaming) return null;
					try {
						await rename.mutateAsync({ id: renaming.id, title });
						setRenaming(null);
						return null;
					} catch (failure) {
						return failure instanceof Error
							? failure.message
							: "The name was not saved.";
					}
				}}
			/>
		</>
	);
}
