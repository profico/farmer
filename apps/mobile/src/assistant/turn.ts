import type { AssistantEvent, AssistantMessage } from "@farmer/api-client";

/**
 * The state of one assistant turn, and how each streamed event changes it.
 * No React here, so `bun test` reads it directly. The web app's run store
 * (`apps/web/src/components/assistant/assistant-runs.tsx`) has the same
 * rules.
 */

export type ToolTrace = {
	toolCallId: string;
	name: string;
	/** Null while the tool runs. */
	ok: boolean | null;
	/** The raw JSON that the model sent. */
	arguments: string;
	/** Only on a stored write that has an inverse. */
	undo?: {
		done: boolean;
		busy: boolean;
		disabled: boolean;
		onUndo: () => void;
	};
};

export type ApprovalPreview = {
	columns: string[];
	rows: { id: string; cells: string[] }[];
	note: string | null;
};

export type PendingApproval = {
	toolCallId: string;
	name: string;
	summary: string;
	arguments: string;
	selectable: boolean;
	preview: ApprovalPreview | null;
};

export type Run = {
	/** The text of the answer so far. */
	text: string;
	/** What the person sent, until the stored copy arrives. */
	sentMessage: string | null;
	/** The id of the stored copy: the server's receipt. */
	sentMessageId: string | null;
	traces: ToolTrace[];
	pending: PendingApproval | null;
	error: string | null;
	isStreaming: boolean;
	/** At least one `delta` arrived. */
	streamed: boolean;
};

export const IDLE: Run = {
	text: "",
	sentMessage: null,
	sentMessageId: null,
	traces: [],
	pending: null,
	error: null,
	isStreaming: false,
	streamed: false,
};

/**
 * The tools that only read (`kind: "read"` in `assistant-tools.ts` of
 * `@farmer/core`). A tool that is not in this list may write, so a turn
 * that called one makes the cached workspace stale. A new tool of the
 * server is thus treated as a write until it is added here.
 */
const READ_TOOLS = new Set([
	"whoami",
	"list_time_entries",
	"list_unfiled_entries",
	"list_projects",
	"list_tasks",
	"list_clients",
	"list_members",
	"list_project_members",
	"list_holidays",
	"list_recurring_block_rules",
	"integration_status",
	"list_filing_rules",
	"list_commits",
	"list_pull_requests",
	"suggest_day",
	"time_report_summary",
	"time_report_detail",
	"my_targets",
	"tracking_report",
	"overtime_report",
	"unfiled_summary",
	"absence_totals",
	"list_absences",
	"absence_report",
]);

/** True when the turn called a tool that may have changed data. A refused
 *  approval leaves no trace, so it does not count. */
export const ranWriteTool = (traces: ToolTrace[]) =>
	traces.some((trace) => !READ_TOOLS.has(trace.name));

/** The run at the start of a turn. */
export const startRun = (sentMessage: string | null): Run => ({
	...IDLE,
	sentMessage,
	isStreaming: true,
});

/** The run after one event of the stream. */
export const applyEvent = (run: Run, event: AssistantEvent): Run => {
	switch (event.type) {
		case "message":
			// The server stores the person's message before it calls the
			// model. The id is the receipt that the message landed.
			return event.role === "user"
				? { ...run, sentMessageId: event.messageId }
				: run;
		case "delta":
			return { ...run, text: run.text + event.text, streamed: true };
		case "tool_start":
			return {
				...run,
				traces: [
					...run.traces,
					{
						toolCallId: event.toolCallId,
						name: event.name,
						ok: null,
						arguments: event.arguments,
					},
				],
			};
		case "tool_result":
			return {
				...run,
				traces: run.traces.map((trace) =>
					trace.toolCallId === event.toolCallId
						? { ...trace, ok: event.ok }
						: trace,
				),
			};
		case "approval_required":
			return {
				...run,
				pending: {
					toolCallId: event.toolCallId,
					name: event.name,
					summary: event.summary,
					arguments: event.arguments,
					selectable: event.selectable,
					preview: event.preview
						? { ...event.preview, note: event.preview.note ?? null }
						: null,
				},
			};
		case "error":
			return { ...run, error: event.message };
		case "title":
		case "done":
			return run;
	}
};

/**
 * The approval that a stored thread still waits for, or null. The waiting
 * call is the one in the row's `toolCalls` that no `tool` row answers before
 * the next assistant row. A card read from the thread works after the app
 * was closed, because approving is a second request.
 */
export const storedPending = (
	messages: AssistantMessage[],
): PendingApproval | null => {
	const index = messages.findIndex((message) => message.pendingApproval);
	const row = messages[index];
	if (!row) return null;
	const after = messages.slice(index + 1);
	const end = after.findIndex((message) => message.role === "assistant");
	const answered = new Set(
		(end === -1 ? after : after.slice(0, end))
			.filter((message) => message.role === "tool")
			.map((message) => message.toolCallId),
	);
	const call = row.toolCalls?.find((entry) => !answered.has(entry.id));
	if (!call) return null;
	return {
		toolCallId: call.id,
		name: call.name,
		summary: row.approvalSummary ?? call.name.replaceAll("_", " "),
		arguments: call.arguments,
		preview: row.approvalPreview
			? {
					columns: row.approvalPreview.columns,
					rows: row.approvalPreview.rows,
					note: row.approvalPreview.note,
				}
			: null,
		selectable: Boolean(row.approvalPreview?.selectable),
	};
};

/**
 * The approval card to draw. While a turn answers, the stored thread still
 * holds the call that was just answered, so the card comes from the live
 * run only. It comes from the stored thread again when the turn is over,
 * or when it failed before it answered anything.
 */
export const visiblePending = (
	run: Run,
	messages: AssistantMessage[],
): PendingApproval | null => {
	if (run.pending) return run.pending;
	const answering = run.isStreaming || run.text !== "" || run.traces.length > 0;
	return answering ? null : storedPending(messages);
};

/** The rows of a stored thread that the transcript draws: the person's
 *  messages, the assistant's text, and the tool row of a write that can be
 *  undone or was undone. Other tool rows and a pure tool turn are not drawn. */
export const visibleMessages = (messages: AssistantMessage[]) =>
	messages.filter(
		(message) =>
			message.role === "user" ||
			(message.role === "tool" && (message.undoable || message.undone)) ||
			(message.role === "assistant" && message.content.trim() !== ""),
	);
