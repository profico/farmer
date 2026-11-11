// The assistant projections. The settings row holds the organization's
// OpenRouter key, so the settings test hands the projection one and checks
// that it does not come out. The message test pins what the mobile app needs
// to answer a waiting approval card.

import { describe, expect, test } from "bun:test";

import {
	toApiAssistantMessage,
	toApiAssistantSettings,
	toApiAssistantThread,
} from "./assistant";

const AT = new Date("2026-10-06T08:00:00Z");

describe("toApiAssistantSettings", () => {
	test("keeps the hint and never the key", () => {
		const view = {
			configured: true,
			keyUnreadable: false,
			enabled: true,
			defaultModel: "openai/gpt-4o-mini",
			keyHint: "sk-or-v1-a1b2c3••••••••",
			systemPrompt: null,
			connectedAt: AT,
			apiKey: "sk-or-v1-a1b2c3d4e5f6-the-whole-key",
		};
		const settings = toApiAssistantSettings(view, true);
		expect(settings).toStrictEqual({
			available: true,
			configured: true,
			keyUnreadable: false,
			enabled: true,
			defaultModel: "openai/gpt-4o-mini",
			keyHint: "sk-or-v1-a1b2c3••••••••",
			systemPrompt: null,
			connectedAt: "2026-10-06T08:00:00.000Z",
		});
		expect(JSON.stringify(settings)).not.toContain("the-whole-key");
	});
});

describe("toApiAssistantThread", () => {
	test("keeps exactly the fields it names", () => {
		const row = {
			id: "t-1",
			organizationId: "org-1",
			userId: "u-1",
			title: "Hours in August",
			model: "openai/gpt-4o-mini",
			createdAt: AT,
			updatedAt: AT,
			sharedAt: AT,
		};
		expect(toApiAssistantThread(row)).toStrictEqual({
			id: "t-1",
			title: "Hours in August",
			model: "openai/gpt-4o-mini",
			updatedAt: "2026-10-06T08:00:00.000Z",
			sharedAt: "2026-10-06T08:00:00.000Z",
		});
	});
});

describe("toApiAssistantMessage", () => {
	const base = {
		id: "m-1",
		organizationId: "org-1",
		conversationId: "t-1",
		content: "",
		toolCalls: null,
		toolCallId: null,
		toolName: null,
		pendingApproval: false,
		approvalDecision: null,
		approvalSummary: null,
		approvalPreview: null,
		undo: null,
		undoneAt: null,
		model: "openai/gpt-4o-mini",
		promptTokens: 120,
		completionTokens: 30,
		createdAt: AT,
	};

	test("a waiting card carries the call id, the summary and the rows", () => {
		const row = {
			...base,
			role: "assistant" as const,
			toolCalls: [{ id: "call_1", name: "file_time_entries", arguments: "{}" }],
			pendingApproval: true,
			approvalSummary: "File 2 entries to Acme",
			approvalPreview: {
				columns: ["Date", "Note"],
				rows: [{ id: "e-1", cells: ["2026-10-05", "Standup"] }],
				selectable: true,
			},
		};
		expect(toApiAssistantMessage(row)).toStrictEqual({
			id: "m-1",
			role: "assistant",
			content: "",
			toolCalls: [{ id: "call_1", name: "file_time_entries", arguments: "{}" }],
			toolCallId: null,
			toolName: null,
			pendingApproval: true,
			approvalDecision: null,
			approvalSummary: "File 2 entries to Acme",
			approvalPreview: {
				columns: ["Date", "Note"],
				rows: [{ id: "e-1", cells: ["2026-10-05", "Standup"] }],
				note: null,
				selectable: true,
			},
			undoable: false,
			undone: false,
			createdAt: "2026-10-06T08:00:00.000Z",
		});
	});

	// The web app reads a missing flag as false, and the API must agree with
	// it, or the two clients draw the same card differently.
	test("a preview with no `selectable` is a list to read", () => {
		const row = {
			...base,
			role: "assistant" as const,
			approvalPreview: { columns: ["A"], rows: [], note: "+ 3 more" },
		};
		expect(toApiAssistantMessage(row).approvalPreview).toStrictEqual({
			columns: ["A"],
			rows: [],
			note: "+ 3 more",
			selectable: false,
		});
	});

	test("an unknown decision reads as none", () => {
		const row = {
			...base,
			role: "tool" as const,
			toolCallId: "call_1",
			toolName: "delete_time_entry",
			approvalDecision: "maybe",
		};
		expect(toApiAssistantMessage(row).approvalDecision).toBeNull();
		expect(
			toApiAssistantMessage({ ...row, approvalDecision: "rejected" })
				.approvalDecision,
		).toBe("rejected");
	});
});
