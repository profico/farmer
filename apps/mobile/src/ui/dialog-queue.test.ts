import { beforeEach, describe, expect, test } from "bun:test";

import {
	currentDialog,
	dismissDialog,
	enqueueDialog,
	pressDialogButton,
	resetDialogs,
} from "./dialog-queue";

beforeEach(resetDialogs);

describe("button defaults", () => {
	test("gives one OK button when there is no button", () => {
		enqueueDialog("Saved");
		expect(currentDialog()?.buttons.map((b) => b.text)).toEqual(["OK"]);
	});

	test("gives one OK button for an empty list", () => {
		enqueueDialog("Saved", "Done", []);
		expect(currentDialog()?.buttons.map((b) => b.text)).toEqual(["OK"]);
	});

	test("is not cancelable unless the options say so", () => {
		enqueueDialog("Saved");
		expect(currentDialog()?.cancelable).toBe(false);
		resetDialogs();
		enqueueDialog("Saved", undefined, undefined, { cancelable: true });
		expect(currentDialog()?.cancelable).toBe(true);
	});
});

describe("queue", () => {
	test("shows the dialogs in the order of the calls", () => {
		enqueueDialog("One");
		enqueueDialog("Two");
		expect(currentDialog()?.title).toBe("One");
		const first = currentDialog();
		if (first) pressDialogButton(first.id, 0);
		expect(currentDialog()?.title).toBe("Two");
	});

	test("keeps a dialog that a button handler opens", () => {
		const first = enqueueDialog("One", undefined, [
			{ text: "Go", onPress: () => enqueueDialog("Two") },
		]);
		pressDialogButton(first, 0);
		expect(currentDialog()?.title).toBe("Two");
	});

	test("runs the handler of the pressed button only", () => {
		const calls: string[] = [];
		const id = enqueueDialog("One", undefined, [
			{ text: "Cancel", style: "cancel", onPress: () => calls.push("cancel") },
			{ text: "Delete", onPress: () => calls.push("delete") },
		]);
		pressDialogButton(id, 1);
		expect(calls).toEqual(["delete"]);
		expect(currentDialog()).toBeUndefined();
	});
});

describe("dismiss", () => {
	test("keeps a dialog that is not cancelable", () => {
		let dismissed = false;
		const id = enqueueDialog("One", undefined, undefined, {
			onDismiss: () => {
				dismissed = true;
			},
		});
		dismissDialog(id);
		expect(currentDialog()?.title).toBe("One");
		expect(dismissed).toBe(false);
	});

	test("closes a cancelable dialog and calls onDismiss", () => {
		let dismissed = false;
		const id = enqueueDialog("One", undefined, undefined, {
			cancelable: true,
			onDismiss: () => {
				dismissed = true;
			},
		});
		dismissDialog(id);
		expect(currentDialog()).toBeUndefined();
		expect(dismissed).toBe(true);
	});
});
