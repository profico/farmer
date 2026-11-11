/**
 * The assistant, as the REST API answers it: the settings, the threads and
 * their messages, and the events of a streamed turn.
 *
 * The OpenRouter key is never here. `ApiAssistantSettings` carries the hint
 * that `assistantService.settings.get` already masks, and nothing else about
 * the key.
 *
 * A thread belongs to one person. The service reads only the caller's own, so
 * another person's thread is a 404 and not a 403.
 */

import type { OpenRouterModel } from "../lib/openrouter-client";
import type {
	AssistantEvent,
	AssistantSettingsView,
} from "../services/assistant.service";

/** `GET /api/v1/orgs/$slug/assistant/settings`. Any member may read it: the
 *  app needs it to decide whether to show the chat at all. */
export type ApiAssistantSettings = {
	/** False when the deployment has the assistant switched off. The thread
	 *  routes then answer 404, and the settings writes and the model list are
	 *  refused. `DELETE` on the settings still works. */
	available: boolean;
	/** A usable key is stored. */
	configured: boolean;
	/** A key is stored and does not decrypt. Paste it again to fix it. */
	keyUnreadable: boolean;
	/** False when an admin paused the assistant for this organization. */
	enabled: boolean;
	defaultModel: string | null;
	/** The first characters of the key, then a fixed mask. */
	keyHint: string | null;
	/** House rules an admin added to the prompt. */
	systemPrompt: string | null;
	connectedAt: string | null;
};

export const toApiAssistantSettings = (
	view: AssistantSettingsView,
	available: boolean,
): ApiAssistantSettings => ({
	available,
	configured: view.configured,
	keyUnreadable: view.keyUnreadable,
	enabled: view.enabled,
	defaultModel: view.defaultModel,
	keyHint: view.keyHint,
	systemPrompt: view.systemPrompt,
	connectedAt: view.connectedAt ? view.connectedAt.toISOString() : null,
});

/** `GET /api/v1/orgs/$slug/assistant/models`. Admin only. */
export type ApiAssistantModel = {
	id: string;
	name: string;
	contextLength: number | null;
	/** USD per million prompt tokens. */
	promptPrice: number | null;
	supportsTools: boolean;
};

export const toApiAssistantModel = (
	model: OpenRouterModel,
): ApiAssistantModel => ({
	id: model.id,
	name: model.name,
	contextLength: model.contextLength,
	promptPrice: model.promptPrice,
	supportsTools: model.supportsTools,
});

/** One conversation, as the thread list shows it. */
export type ApiAssistantThread = {
	id: string;
	title: string;
	/** The model the thread was pinned to when it started. */
	model: string;
	updatedAt: string;
};

export const toApiAssistantThread = (row: {
	id: string;
	title: string;
	model: string;
	updatedAt: Date;
}): ApiAssistantThread => ({
	id: row.id,
	title: row.title,
	model: row.model,
	updatedAt: row.updatedAt.toISOString(),
});

export type ApiAssistantToolCall = {
	id: string;
	name: string;
	/** The raw JSON the model sent. */
	arguments: string;
};

/** The rows of a batch write's approval card. */
export type ApiApprovalPreview = {
	columns: string[];
	rows: { id: string; cells: string[] }[];
	note: string | null;
	/** Whether the card offers a tick per row. */
	selectable: boolean;
};

/**
 * One stored message.
 *
 * An `assistant` row with `toolCalls` asked for tools; a `tool` row is the
 * result of the call named by `toolCallId`. A row with `pendingApproval` is a
 * card waiting for an answer: `POST …/approvals` with the `id` of the call in
 * its `toolCalls` that no `tool` row answers yet.
 */
export type ApiAssistantMessage = {
	id: string;
	role: "user" | "assistant" | "tool";
	content: string;
	toolCalls: ApiAssistantToolCall[] | null;
	toolCallId: string | null;
	toolName: string | null;
	pendingApproval: boolean;
	approvalDecision: "approved" | "rejected" | null;
	/** The sentence the approval card showed. */
	approvalSummary: string | null;
	approvalPreview: ApiApprovalPreview | null;
	/** A `tool` row whose write can still be undone:
	 *  `POST …/messages/$messageId/undo`. */
	undoable: boolean;
	/** The person undid this write. */
	undone: boolean;
	createdAt: string;
};

const decisionOf = (value: string | null): "approved" | "rejected" | null => {
	switch (value) {
		case "approved":
		case "rejected":
			return value;
		default:
			return null;
	}
};

export const toApiAssistantMessage = (row: {
	id: string;
	role: "user" | "assistant" | "tool";
	content: string;
	toolCalls: { id: string; name: string; arguments: string }[] | null;
	toolCallId: string | null;
	toolName: string | null;
	pendingApproval: boolean;
	approvalDecision: string | null;
	approvalSummary: string | null;
	approvalPreview: {
		columns: string[];
		rows: { id: string; cells: string[] }[];
		note?: string;
		selectable?: boolean;
	} | null;
	undo: object | null;
	undoneAt: Date | null;
	createdAt: Date;
}): ApiAssistantMessage => ({
	id: row.id,
	role: row.role,
	content: row.content,
	toolCalls: row.toolCalls
		? row.toolCalls.map((call) => ({
				id: call.id,
				name: call.name,
				arguments: call.arguments,
			}))
		: null,
	toolCallId: row.toolCallId,
	toolName: row.toolName,
	pendingApproval: row.pendingApproval,
	approvalDecision: decisionOf(row.approvalDecision),
	approvalSummary: row.approvalSummary,
	approvalPreview: row.approvalPreview
		? {
				columns: [...row.approvalPreview.columns],
				rows: row.approvalPreview.rows.map((r) => ({
					id: r.id,
					cells: [...r.cells],
				})),
				note: row.approvalPreview.note ?? null,
				// The web app reads a missing flag as false, so this does too.
				selectable: row.approvalPreview.selectable ?? false,
			}
		: null,
	undoable: row.undo !== null && row.undoneAt === null,
	undone: row.undoneAt !== null,
	createdAt: row.createdAt.toISOString(),
});

/** `POST …/threads/$id/rewind`: the removed question, to send again. */
export type ApiAssistantRewind = { content: string };

/** `GET /api/v1/orgs/$slug/assistant/threads/$id`. Messages oldest first. */
export type ApiAssistantThreadDetail = {
	thread: ApiAssistantThread;
	messages: ApiAssistantMessage[];
	/** Prompt tokens of the last model call. Null before the first answer. */
	promptTokens: number | null;
	/** Context size of the thread's model. Null when unknown. */
	contextLength: number | null;
};

/**
 * One event of a streamed turn: the `data:` line of each Server-Sent Event,
 * as JSON. The same events the web app's chat reads.
 */
export type ApiAssistantEvent = AssistantEvent;
