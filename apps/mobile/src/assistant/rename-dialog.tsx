import { useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, View } from "react-native";

import { ActionButton, Card, ErrorBanner, Field, Text } from "../ui/components";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";

/** The longest title the server keeps. */
const MAX_TITLE = 200;

/**
 * A small dialog with one field, to rename a conversation. Android has no
 * text prompt of its own, so both platforms use this one.
 */
export function RenameDialog({
	initial,
	onCancel,
	onSave,
}: {
	/** The current title. Null closes the dialog. */
	initial: string | null;
	onCancel: () => void;
	/** Resolves with an error sentence, or null when the name was saved. */
	onSave: (title: string) => Promise<string | null>;
}) {
	const palette = usePalette();
	const [title, setTitle] = useState(initial ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const save = async () => {
		const next = title.trim();
		if (!next) {
			setError("Give it a name.");
			return;
		}
		setSaving(true);
		setError(await onSave(next));
		setSaving(false);
	};

	return (
		<Modal
			visible={initial !== null}
			transparent
			animationType="fade"
			onRequestClose={onCancel}
			onShow={() => {
				setTitle(initial ?? "");
				setError(null);
			}}
		>
			<KeyboardAvoidingView
				behavior="padding"
				style={{ flex: 1, justifyContent: "center", padding: SPACE.xl }}
			>
				{/* The scrim: the screen behind, dimmed. A tap on it cancels. */}
				<Pressable
					accessibilityLabel="Close"
					onPress={onCancel}
					style={{
						position: "absolute",
						top: 0,
						right: 0,
						bottom: 0,
						left: 0,
						backgroundColor: palette.onSurface,
						opacity: 0.32,
					}}
				/>
				<Card>
					<Text variant="titleLarge">Rename the conversation</Text>
					<Field
						label="Name"
						value={title}
						onChangeText={setTitle}
						maxLength={MAX_TITLE}
						autoFocus
						returnKeyType="done"
						onSubmitEditing={() => void save()}
						editable={!saving}
					/>
					{error ? <ErrorBanner message={error} /> : null}
					<View
						style={{
							flexDirection: "row",
							justifyContent: "flex-end",
							gap: SPACE.s,
						}}
					>
						<ActionButton label="Cancel" variant="text" onPress={onCancel} />
						<ActionButton
							label="Save"
							onPress={() => void save()}
							disabled={saving || !title.trim()}
						/>
					</View>
				</Card>
			</KeyboardAvoidingView>
		</Modal>
	);
}
