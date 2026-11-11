// Why the last question of a thread cannot be edited. Pure, so the server and
// the web app give the same text. The mobile app mirrors it in
// `apps/mobile/src/assistant/edit-block.ts`, as it cannot import core.

export const EDIT_AFTER_UNDOABLE_CHANGE =
	"This answer changed your data. Undo the change first, then edit.";

export const EDIT_AFTER_FINAL_CHANGE =
	"This answer changed your data, and the change cannot be undone here. Ask a new question instead.";

/**
 * The reason for a turn whose writes still stand, or null when none does.
 * One write with no inverse makes the whole turn final.
 */
export const editBlockReason = (
	standing: readonly { undoable: boolean }[],
): string | null => {
	if (standing.length === 0) return null;
	return standing.every((write) => write.undoable)
		? EDIT_AFTER_UNDOABLE_CHANGE
		: EDIT_AFTER_FINAL_CHANGE;
};
