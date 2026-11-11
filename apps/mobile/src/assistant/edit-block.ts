import type { AssistantMessage } from "@farmer/api-client";

// Mirror of `editBlockReason` in `packages/core/src/lib/assistant-edit.ts`,
// as the app cannot import core. Keep the two texts equal.
const AFTER_UNDOABLE_CHANGE =
	"This answer changed your data. Undo the change first, then edit.";
const AFTER_FINAL_CHANGE =
	"This answer changed your data, and the change cannot be undone here. Ask a new question instead.";

/** Why the last question cannot be edited because of a write, or null. */
export const editBlockReason = (messages: AssistantMessage[]) => {
	const last = messages.map((message) => message.role).lastIndexOf("user");
	const standing = messages.slice(last).filter((message) => message.changed);
	if (standing.length === 0) return null;
	return standing.every((message) => message.undoable)
		? AFTER_UNDOABLE_CHANGE
		: AFTER_FINAL_CHANGE;
};
