import type { ChatMessage } from "../lib/openrouter-client";

/** Turns (user messages) whose tool results stay whole. Older ones are
 *  stubbed. A fixed count keeps the prompt prefix the same between turns. */
export const KEEP_TOOL_RESULT_TURNS = 4;

/** A shorter result costs nothing, so it stays. */
export const ELIDE_MIN_CHARS = 400;

export const ELIDED_RESULT = JSON.stringify({
	elided: true,
	note: "Older result removed to save space. Call the tool again if you need it.",
});

/**
 * Replace big tool results of old turns with a stub. Wire copy only.
 * Every tool row and its `tool_call_id` stays: one result per call id.
 */
export const elideOldToolResults = (wire: ChatMessage[]): ChatMessage[] => {
	let seen = 0;
	let boundary = -1;
	for (let i = wire.length - 1; i >= 0; i--) {
		if (wire[i]?.role !== "user") continue;
		seen += 1;
		if (seen === KEEP_TOOL_RESULT_TURNS) {
			boundary = i;
			break;
		}
	}
	if (boundary === -1) return wire;
	return wire.map((message, i) =>
		i < boundary &&
		message.role === "tool" &&
		message.content.length > ELIDE_MIN_CHARS
			? { ...message, content: ELIDED_RESULT }
			: message,
	);
};
