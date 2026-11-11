import { describe, expect, test } from "bun:test";

import type { AssistantMessage } from "@farmer/api-client";

import { editBlockReason } from "./edit-block";

const row = (
	partial: Partial<AssistantMessage> & Pick<AssistantMessage, "id" | "role">,
): AssistantMessage => ({
	content: "",
	toolCalls: null,
	toolCallId: null,
	toolName: null,
	pendingApproval: false,
	approvalDecision: null,
	approvalSummary: null,
	approvalPreview: null,
	undoable: false,
	undone: false,
	changed: false,
	createdAt: "2026-10-06T10:00:00.000Z",
	...partial,
});

const question = row({ id: "q", role: "user" });

describe("editBlockReason", () => {
	test("is null when no write stands", () => {
		expect(editBlockReason([question])).toBeNull();
	});

	test("asks for an undo when every write has an inverse", () => {
		const write = row({ id: "t", role: "tool", changed: true, undoable: true });
		expect(editBlockReason([question, write])).toContain("Undo the change");
	});

	test("says to ask again when one write has no inverse", () => {
		const undoable = row({
			id: "a",
			role: "tool",
			changed: true,
			undoable: true,
		});
		const final = row({ id: "b", role: "tool", changed: true });
		expect(editBlockReason([question, undoable, final])).toContain(
			"Ask a new question instead",
		);
	});
});
