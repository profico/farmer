import type { AssistantMessage } from "@farmer/api-client";
import { useState } from "react";
import { View } from "react-native";

import { useRewindThread, useUndoWrite } from "../api/assistant";
import {
	ActionButton,
	ErrorBanner,
	Field,
	IconButton,
	Text,
} from "../ui/components";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import { ToolTraceList } from "./tool-trace";

/** The trace row of a stored write: Undo, or "Undone". */
export function StoredWrite({
	threadId,
	message,
	messages,
	locked,
}: {
	threadId: string;
	message: AssistantMessage;
	messages: AssistantMessage[];
	/** A turn runs or a card waits. */
	locked: boolean;
}) {
	const undo = useUndoWrite();
	const call = messages
		.flatMap((row) => row.toolCalls ?? [])
		.find((entry) => entry.id === message.toolCallId);
	if (!call) return null;
	return (
		<View style={{ gap: SPACE.xs }}>
			<ToolTraceList
				working={false}
				open
				traces={[
					{
						toolCallId: call.id,
						name: call.name,
						arguments: call.arguments,
						ok: true,
						undo: {
							done: message.undone,
							busy: undo.isPending,
							disabled: locked,
							onUndo: () =>
								undo.mutate({ id: threadId, messageId: message.id }),
						},
					},
				]}
			/>
			{undo.error ? <ErrorBanner message={undo.error.message} /> : null}
		</View>
	);
}

/**
 * Edit and Retry on the last question. Both take the question back from the
 * server, then send the text again as a new turn.
 */
export function LastQuestionActions({
	threadId,
	text,
	reason,
	onSend,
	onRestore,
}: {
	threadId: string;
	text: string;
	/** Why the actions are off, or null. */
	reason: string | null;
	onSend: (text: string) => Promise<boolean>;
	/** The question is gone from the thread and the send failed: put the text
	 *  back in the composer. */
	onRestore: (text: string) => void;
}) {
	const palette = usePalette();
	const rewind = useRewindThread();
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(text);
	const [failure, setFailure] = useState<string | null>(null);

	const resend = async (next: string) => {
		setFailure(null);
		try {
			await rewind.mutateAsync(threadId);
		} catch (error) {
			setFailure(error instanceof Error ? error.message : "Could not send.");
			return;
		}
		setEditing(false);
		// The rewind removed the question, so this row is about to unmount and
		// the composer shows the text and the run shows the error.
		if (!(await onSend(next))) onRestore(next);
	};

	if (editing) {
		return (
			<View style={{ gap: SPACE.s }}>
				<Field
					label="Edit your question"
					value={draft}
					onChangeText={setDraft}
					multiline
					autoFocus
				/>
				<View
					style={{
						flexDirection: "row",
						justifyContent: "flex-end",
						gap: SPACE.s,
					}}
				>
					<ActionButton
						label="Cancel"
						variant="text"
						onPress={() => setEditing(false)}
					/>
					<ActionButton
						label="Send"
						disabled={Boolean(reason) || !draft.trim() || rewind.isPending}
						onPress={() => void resend(draft.trim())}
					/>
				</View>
				{failure ? <ErrorBanner message={failure} /> : null}
			</View>
		);
	}

	return (
		<View style={{ alignItems: "flex-end", gap: SPACE.xs }}>
			<View style={{ flexDirection: "row", gap: SPACE.xs }}>
				<IconButton
					icon="edit"
					label="Edit your question"
					disabled={Boolean(reason)}
					onPress={() => {
						setDraft(text);
						setEditing(true);
					}}
				/>
				<IconButton
					icon="retry"
					label="Ask again"
					disabled={Boolean(reason) || rewind.isPending}
					onPress={() => void resend(text)}
				/>
			</View>
			{reason ? (
				<Text variant="bodySmall" color={palette.onSurfaceVariant}>
					{reason}
				</Text>
			) : null}
			{failure ? <ErrorBanner message={failure} /> : null}
		</View>
	);
}
