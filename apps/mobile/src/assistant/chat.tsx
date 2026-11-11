import { Stack, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
	Keyboard,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	View,
} from "react-native";

import { useAssistantThread, useCreateThread } from "../api/assistant";
import { HeaderActions } from "../navigation/header-actions";
import { ErrorBanner, ErrorState, Skeleton, Text } from "../ui/components";
import { LoadingIndicator } from "../ui/loading";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import { Answer } from "./answer";
import { ApprovalCard } from "./approval-card";
import { Composer } from "./composer";
import { ContextNote } from "./context-note";
import { editBlockReason } from "./edit-block";
import { useRun, useRunActions } from "./runs";
import { useChatHeaderActions } from "./share";
import { LastQuestionActions, StoredWrite } from "./stored-turn";
import { ToolTraceList } from "./tool-trace";
import { visibleMessages, visiblePending } from "./turn";
import { UserMessage } from "./user-message";

const SUGGESTIONS = [
	"How many hours did I log last week?",
	"What have I not filed to a project yet this month?",
	"Which project took most of my time last month?",
];

/** Closer to the end than this, the transcript follows a new answer. */
const PIN_DISTANCE = 96;

/** True while the keyboard is open, to drop the bottom inset under it. */
const useKeyboardOpen = () => {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		const show = Keyboard.addListener(
			Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
			() => setOpen(true),
		);
		const hide = Keyboard.addListener(
			Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
			() => setOpen(false),
		);
		return () => {
			show.remove();
			hide.remove();
		};
	}, []);
	return open;
};

/**
 * The chat: the transcript, the answer as it streams, the tools it used,
 * an approval card when a write waits, and the composer. With no `id` it is
 * a draft, as on the web: the hero and the composer, and no server call
 * until the first message. That message creates the thread, and the same
 * screen goes on with it.
 */
export function Chat({ id: routeId }: { id: string | null }) {
	const palette = usePalette();
	const router = useRouter();
	// A draft that has made its thread, but whose first message has not
	// arrived yet, shows the run of that thread.
	const [draftId, setDraftId] = useState<string | null>(null);
	// A draft whose first message arrived. The same screen goes on with that
	// thread, so no screen slides in and Back goes where it went before.
	const [startedId, setStartedId] = useState<string | null>(null);
	const id = routeId ?? startedId;
	const thread = useAssistantThread(id);
	const headerActions = useChatHeaderActions(thread.data?.thread);
	const runId = id ?? draftId ?? "";
	const run = useRun(runId);
	const actions = useRunActions();
	const create = useCreateThread();
	// A second send must not make a second thread while the first is made.
	const creating = useRef(false);
	const [draftError, setDraftError] = useState<string | null>(null);
	const scroll = useRef<ScrollView>(null);
	const pinned = useRef(true);
	const frame = useRef<View>(null);
	const [offset, setOffset] = useState(0);
	const keyboardOpen = useKeyboardOpen();

	const messages = thread.data?.messages ?? [];
	const rows = visibleMessages(messages);
	const pending = visiblePending(run, messages);
	const sentStored =
		run.sentMessageId !== null &&
		messages.some((message) => message.id === run.sentMessageId);
	const busy = run.isStreaming;
	const lastUserIndex = rows.map((row) => row.role).lastIndexOf("user");
	const editBlock = busy
		? "Wait for the answer to finish."
		: pending
			? "Answer the card first."
			: editBlockReason(messages);
	const [restore, setRestore] = useState<{ text: string } | null>(null);

	const send = async (text: string) => {
		pinned.current = true;
		if (id !== null) return actions.send(id, text);
		if (creating.current) return false;
		creating.current = true;
		setDraftError(null);
		try {
			// A failed first send keeps its thread, so a second try does not
			// leave a second empty one.
			const threadId = draftId ?? (await create.mutateAsync()).id;
			setDraftId(threadId);
			// Wait until the server has the message. A failed send then stays
			// on the draft, and the composer gives the text back.
			const delivered = await new Promise<boolean>((resolve) => {
				void actions.send(threadId, text, () => resolve(true)).then(resolve);
			});
			if (!delivered) return false;
			// The run lives outside the screen, so this screen goes on with
			// the thread and shows the run without a change of screen.
			setStartedId(threadId);
			return true;
		} catch (failure) {
			setDraftError(
				failure instanceof Error ? failure.message : "The chat did not start.",
			);
			return false;
		} finally {
			creating.current = false;
		}
	};
	const followUp =
		busy || pending ? undefined : (prompt: string) => void send(prompt);

	return (
		<>
			<Stack.Screen
				options={{
					title: id === null ? "New chat" : (thread.data?.thread.title ?? ""),
				}}
			/>
			{/* The history is one tap away, so Back leaves the assistant at once.
			    `dismissTo` goes back to the list when it is under this chat,
			    and replaces the chat with it when it is not. */}
			<HeaderActions actions={headerActions} />
			<View
				ref={frame}
				style={{ flex: 1 }}
				// The keyboard is measured against the window, and this view
				// starts below the header. Its own top is the offset.
				onLayout={() => frame.current?.measureInWindow((_, y) => setOffset(y))}
			>
				<KeyboardAvoidingView
					style={{ flex: 1 }}
					behavior="padding"
					keyboardVerticalOffset={offset}
				>
					<ScrollView
						ref={scroll}
						style={{ flex: 1 }}
						contentContainerStyle={{
							padding: SPACE.l,
							gap: SPACE.xl,
							flexGrow: 1,
						}}
						keyboardDismissMode="interactive"
						keyboardShouldPersistTaps="handled"
						contentInsetAdjustmentBehavior="never"
						scrollEventThrottle={64}
						onScroll={(event) => {
							const { contentOffset, contentSize, layoutMeasurement } =
								event.nativeEvent;
							pinned.current =
								contentSize.height -
									contentOffset.y -
									layoutMeasurement.height <
								PIN_DISTANCE;
						}}
						onContentSizeChange={() => {
							if (pinned.current)
								scroll.current?.scrollToEnd({ animated: false });
						}}
					>
						{id !== null && thread.isPending && !run.sentMessage ? (
							<View style={{ gap: SPACE.m }}>
								<Skeleton height={48} width="60%" />
								<Skeleton height={120} />
							</View>
						) : id !== null && thread.error ? (
							<ErrorState
								error={thread.error}
								onRetry={() => void thread.refetch()}
							/>
						) : null}

						{(id === null || thread.data) &&
						rows.length === 0 &&
						!busy &&
						!run.sentMessage ? (
							<View style={{ gap: SPACE.m, paddingTop: SPACE.xl }}>
								<Text variant="headlineSmall">What can I help with?</Text>
								<Text color={palette.onSurfaceVariant}>
									I can read your tracked time and log more of it. I show you
									every change first.
								</Text>
								<View style={{ gap: SPACE.s, alignItems: "flex-start" }}>
									{SUGGESTIONS.map((suggestion) => (
										<Pressable
											key={suggestion}
											accessibilityRole="button"
											onPress={() => void send(suggestion)}
											android_ripple={{ color: palette.outlineVariant }}
											style={({ pressed }) => ({
												borderRadius: 18,
												borderWidth: 1,
												borderColor: palette.outlineVariant,
												paddingHorizontal: SPACE.m,
												paddingVertical: SPACE.s,
												backgroundColor:
													Platform.OS === "ios" && pressed
														? palette.surfaceContainerHigh
														: undefined,
											})}
										>
											<Text variant="bodyMedium">{suggestion}</Text>
										</Pressable>
									))}
								</View>
							</View>
						) : null}

						{rows.map((message, index) => {
							if (message.role === "user") {
								return (
									<View key={message.id} style={{ gap: SPACE.xs }}>
										<UserMessage text={message.content} />
										{index === lastUserIndex && id !== null ? (
											<LastQuestionActions
												threadId={id}
												text={message.content}
												reason={editBlock}
												onSend={send}
												onRestore={(text) => setRestore({ text })}
											/>
										) : null}
									</View>
								);
							}
							if (message.role === "tool") {
								return id === null ? null : (
									<StoredWrite
										key={message.id}
										threadId={id}
										message={message}
										messages={messages}
										locked={busy || pending !== null}
									/>
								);
							}
							return (
								<Answer
									key={message.id}
									text={message.content}
									onFollowUp={followUp}
								/>
							);
						})}

						{run.sentMessage !== null && !sentStored ? (
							<UserMessage text={run.sentMessage} />
						) : null}

						<ToolTraceList traces={run.traces} working={busy && !pending} />

						{run.text ? <Answer text={run.text} streaming={busy} /> : null}

						{busy && !run.text && run.traces.length === 0 ? (
							<View
								accessibilityLabel="Thinking"
								style={{
									flexDirection: "row",
									gap: SPACE.s,
									alignItems: "center",
								}}
							>
								<LoadingIndicator size={24} color={palette.onSurfaceVariant} />
								<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
									Thinking
								</Text>
							</View>
						) : null}

						{pending ? (
							<ApprovalCard
								pending={pending}
								busy={busy}
								onDecide={(decision, selectedRowIds) => {
									pinned.current = true;
									if (id === null) return;
									void actions.resolve(
										id,
										pending.toolCallId,
										decision,
										selectedRowIds,
									);
								}}
							/>
						) : null}

						{run.error ? <ErrorBanner message={run.error} /> : null}
						{draftError ? <ErrorBanner message={draftError} /> : null}
					</ScrollView>
					<ContextNote
						used={thread.data?.promptTokens}
						limit={thread.data?.contextLength}
						onNewChat={() => router.replace("/assistant/new")}
					/>
					<Composer
						onSend={send}
						onStop={() => runId !== "" && actions.stop(runId)}
						streaming={busy}
						locked={pending !== null}
						keyboardOpen={keyboardOpen}
						placeholder="Ask about your time"
						autoFocus={id === null}
						restore={restore}
					/>
				</KeyboardAvoidingView>
			</View>
		</>
	);
}
