import type { AlertButton, AlertOptions } from "react-native";

// The queue of the dialogs that Android draws. The logic has no React and no
// native code, so a test can run it. `dialog-host.android.tsx` draws the first
// dialog of the queue.

export type QueuedDialog = {
	id: number;
	title: string;
	message: string | undefined;
	/** Never empty: a call with no button gets one "OK". */
	buttons: readonly AlertButton[];
	/** A tap outside or Back dismisses the dialog only when this is true. */
	cancelable: boolean;
	onDismiss: (() => void) | undefined;
};

const DEFAULT_BUTTONS: readonly AlertButton[] = [{ text: "OK" }];

let queue: readonly QueuedDialog[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const publish = (next: readonly QueuedDialog[]) => {
	queue = next;
	for (const listener of listeners) listener();
};

/** Adds a dialog to the end of the queue. It shows after the others close. */
export const enqueueDialog = (
	title: string,
	message?: string,
	buttons?: readonly AlertButton[],
	options?: AlertOptions,
): number => {
	const id = nextId++;
	publish([
		...queue,
		{
			id,
			title,
			message: message || undefined,
			buttons: buttons && buttons.length > 0 ? buttons : DEFAULT_BUTTONS,
			// Alert.alert on Android is not cancelable unless the options say so.
			cancelable: options?.cancelable ?? false,
			onDismiss: options?.onDismiss,
		},
	]);
	return id;
};

/** Removes a dialog from the queue. A dialog that is gone already is a no-op. */
const remove = (id: number): QueuedDialog | undefined => {
	const dialog = queue.find((entry) => entry.id === id);
	if (dialog) publish(queue.filter((entry) => entry.id !== id));
	return dialog;
};

/**
 * Closes a dialog, then runs the press handler of one of its buttons. The
 * dialog leaves the queue first, so a handler that opens a second dialog
 * queues it behind the rest and does not lose it.
 */
export const pressDialogButton = (id: number, index: number) => {
	const dialog = remove(id);
	dialog?.buttons[index]?.onPress?.();
};

/** Closes a dialog by a tap outside or Back. Does nothing when the dialog is
 *  not cancelable. */
export const dismissDialog = (id: number) => {
	const dialog = queue.find((entry) => entry.id === id);
	if (!dialog?.cancelable) return;
	remove(id);
	dialog.onDismiss?.();
};

export const currentDialog = (): QueuedDialog | undefined => queue[0];

export const subscribeDialogs = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/** For a test: empties the queue and the listeners. */
export const resetDialogs = () => {
	queue = [];
	listeners.clear();
};
