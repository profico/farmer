import { useEffect, useRef } from "react";
import { Alert } from "react-native";

/** The longest title the server keeps. */
const MAX_TITLE = 200;

/**
 * The rename of a conversation, as the system alert with a text field. The
 * system draws it, with Cancel and Save. Android draws its own dialog
 * (`rename-dialog.tsx`).
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
	const latest = useRef({ onCancel, onSave });
	useEffect(() => {
		latest.current = { onCancel, onSave };
	});
	useEffect(() => {
		if (initial === null) return;
		// An alert closes on any button, so a failed save asks again.
		const ask = (text: string) =>
			Alert.prompt(
				"Rename the conversation",
				undefined,
				[
					{
						text: "Cancel",
						style: "cancel",
						onPress: () => latest.current.onCancel(),
					},
					{
						text: "Save",
						isPreferred: true,
						onPress: (value?: string) => {
							const next = (value ?? "").slice(0, MAX_TITLE).trim();
							const fail = (message: string) =>
								Alert.alert(message, undefined, [
									{ text: "OK", onPress: () => ask(value ?? text) },
								]);
							if (!next) {
								fail("Give it a name.");
								return;
							}
							void latest.current.onSave(next).then((error) => {
								if (error) fail(error);
							});
						},
					},
				],
				"plain-text",
				text,
			);
		ask(initial);
	}, [initial]);
	return null;
}
