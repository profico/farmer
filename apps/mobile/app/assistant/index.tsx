import type { AssistantThread } from "@farmer/api-client";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
	useAssistantThreads,
	useDeleteThread,
	useRenameThread,
} from "../../src/api/assistant";
import { AssistantGate, useAssistantReady } from "../../src/assistant/gate";
import { RenameDialog } from "../../src/assistant/rename-dialog";
import { useThreadRunning } from "../../src/assistant/runs";
import {
	FAB_CLEARANCE,
	FAB_MARGIN,
	FAB_SIZE,
} from "../../src/time/components/log-time-fab";
import {
	ActionButton,
	EmptyState,
	ErrorBanner,
	ErrorState,
	IconButton,
	ListRow,
	Skeleton,
	Text,
} from "../../src/ui/components";
import { RADIUS } from "../../src/ui/corner";
import { showDialog } from "../../src/ui/dialog";
import { Icon } from "../../src/ui/icon";
import { LoadingIndicator } from "../../src/ui/loading";
import { useOpenRowMenu } from "../../src/ui/row-menu";
import { Inset, usePullToRefresh } from "../../src/ui/screen";
import { usePalette } from "../../src/ui/theme";
import { SPACE } from "../../src/ui/type";

/** The gap between the icon and the label of the pill. */
const PILL_GAP = SPACE.m;

/** "New chat": an extended FAB at the bottom right, in the style of the
 *  Log time pill of the Time tab. */
function NewChatPill({ onPress }: { onPress: () => void }) {
	const palette = usePalette();
	const insets = useSafeAreaInsets();
	return (
		<View
			pointerEvents="box-none"
			style={{
				position: "absolute",
				right: FAB_MARGIN,
				bottom: FAB_MARGIN + insets.bottom,
			}}
		>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="New chat"
				onPress={onPress}
				android_ripple={{
					color: palette.onPrimaryContainer,
					borderless: false,
				}}
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: PILL_GAP,
					height: FAB_SIZE,
					paddingHorizontal: SPACE.l,
					borderRadius: RADIUS.fab,
					overflow: "hidden",
					backgroundColor: palette.primaryContainer,
					elevation: 3,
				}}
			>
				<Icon name="add" color={palette.onPrimaryContainer} />
				<Text variant="labelLarge" color={palette.onPrimaryContainer}>
					New chat
				</Text>
			</Pressable>
		</View>
	);
}

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
	onRename,
	onDelete,
}: {
	thread: AssistantThread;
	/** The time the list was opened, for the "Today" and "Yesterday" words. */
	now: number;
	onOpen: () => void;
	onRename: () => void;
	onDelete: () => void;
}) {
	const palette = usePalette();
	const running = useThreadRunning(thread.id);
	const openMenu = useOpenRowMenu();
	// A long press and the "more" button open the same menu.
	const actions = [
		{ label: "Rename", icon: "edit", onPress: onRename },
		{ label: "Delete", icon: "delete", destructive: true, onPress: onDelete },
	] as const;
	return (
		<ListRow
			icon="assistant"
			title={thread.title}
			subtitle={running ? "Working" : whenOf(thread.updatedAt, now)}
			onPress={onOpen}
			actions={actions}
			trailing={
				<View style={{ flexDirection: "row", alignItems: "center" }}>
					{running ? (
						<LoadingIndicator size={24} color={palette.primary} />
					) : null}
					<IconButton
						icon="more"
						label={`Actions for ${thread.title}`}
						onPress={() => openMenu(thread.title, actions)}
					/>
				</View>
			}
		/>
	);
}

/**
 * The person's conversations with the assistant, newest first. A row opens
 * the conversation. A long press, or the "more" button, renames or deletes it.
 */
export default function AssistantThreadsScreen() {
	const router = useRouter();
	const palette = usePalette();
	const threads = useAssistantThreads();
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

	// A chat with no thread yet: the thread is made at the first message.
	const start = () => router.push("/assistant/new");

	const confirmDelete = (thread: AssistantThread) =>
		showDialog(
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

	return (
		<>
			<Stack.Screen
				options={{
					title: "Assistant",
				}}
			/>
			<AssistantGate>
				<FlatList
					data={threads.data ?? []}
					contentContainerStyle={{ paddingBottom: FAB_CLEARANCE }}
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
									<ActionButton label="Start a conversation" onPress={start} />
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
							onRename={() => setRenaming(item)}
							onDelete={() => confirmDelete(item)}
						/>
					)}
				/>
			</AssistantGate>
			{/* No new chat while the gate above says why the assistant
			    cannot answer. */}
			{ready ? <NewChatPill onPress={start} /> : null}
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
