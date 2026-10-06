import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	Keyboard,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	View,
} from "react-native";

import { useAssistantThread } from "../../src/api/assistant";
import { Answer } from "../../src/assistant/answer";
import { ApprovalCard } from "../../src/assistant/approval-card";
import { Composer } from "../../src/assistant/composer";
import { AssistantGate } from "../../src/assistant/gate";
import { useRun, useRunActions } from "../../src/assistant/runs";
import { ToolTraceList } from "../../src/assistant/tool-trace";
import { storedPending, visibleMessages } from "../../src/assistant/turn";
import {
	ErrorBanner,
	ErrorState,
	Skeleton,
	Text,
} from "../../src/ui/components";
import { usePalette } from "../../src/ui/theme";
import { SPACE } from "../../src/ui/type";

const SUGGESTIONS = [
	"How many hours did I log last week?",
	"What have I not filed to a project yet this month?",
	"Which project took most of my time last month?",
];

/** Closer to the end than this, the transcript follows a new answer. */
const PIN_DISTANCE = 96;

/** One thing the person said. */
function UserMessage({ text }: { text: string }) {
	const palette = usePalette();
	return (
		<View style={{ alignItems: "flex-end" }}>
			<View
				style={{
					maxWidth: "85%",
					borderRadius: 20,
					paddingHorizontal: SPACE.l,
					paddingVertical: SPACE.m,
					backgroundColor: palette.secondaryContainer,
				}}
			>
				<Text color={palette.onSecondaryContainer}>{text}</Text>
			</View>
		</View>
	);
}

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

function Conversation({ id }: { id: string }) {
	const palette = usePalette();
	const thread = useAssistantThread(id);
	const run = useRun(id);
	const actions = useRunActions();
	const scroll = useRef<ScrollView>(null);
	const pinned = useRef(true);
	const frame = useRef<View>(null);
	const [offset, setOffset] = useState(0);
	const keyboardOpen = useKeyboardOpen();

	const messages = thread.data?.messages ?? [];
	const rows = visibleMessages(messages);
	const pending = run.pending ?? storedPending(messages);
	const sentStored =
		run.sentMessageId !== null &&
		messages.some((message) => message.id === run.sentMessageId);
	const busy = run.isStreaming;

	const send = (text: string) => {
		pinned.current = true;
		return actions.send(id, text);
	};
	const followUp =
		busy || pending ? undefined : (prompt: string) => void send(prompt);

	return (
		<>
			<Stack.Screen options={{ title: thread.data?.thread.title ?? "" }} />
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
						{thread.isPending ? (
							<View style={{ gap: SPACE.m }}>
								<Skeleton height={48} width="60%" />
								<Skeleton height={120} />
							</View>
						) : thread.error ? (
							<ErrorState
								error={thread.error}
								onRetry={() => void thread.refetch()}
							/>
						) : null}

						{thread.data && rows.length === 0 && !busy && !run.sentMessage ? (
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

						{rows.map((message) =>
							message.role === "user" ? (
								<UserMessage key={message.id} text={message.content} />
							) : (
								<Answer
									key={message.id}
									text={message.content}
									onFollowUp={followUp}
								/>
							),
						)}

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
								<ActivityIndicator color={palette.onSurfaceVariant} />
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
					</ScrollView>
					<Composer
						onSend={send}
						onStop={() => actions.stop(id)}
						streaming={busy}
						locked={pending !== null}
						keyboardOpen={keyboardOpen}
						placeholder="Ask about your time"
					/>
				</KeyboardAvoidingView>
			</View>
		</>
	);
}

/**
 * One conversation: the transcript, the answer as it streams, the tools it
 * used, an approval card when a write waits, and the composer.
 */
export default function ConversationScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	return (
		<>
			{/* A title until the conversation sets its own. Without it, a
			    closed gate showed the name of the route file, "[id]". */}
			<Stack.Screen options={{ title: "Conversation" }} />
			<AssistantGate>
				<Conversation id={id ?? ""} />
			</AssistantGate>
		</>
	);
}
