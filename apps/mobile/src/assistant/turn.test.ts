import { describe, expect, test } from "bun:test";

import type { AssistantEvent, AssistantMessage } from "@farmer/api-client";

import {
	applyEvent,
	IDLE,
	ranWriteTool,
	startRun,
	storedPending,
	visibleMessages,
	visiblePending,
} from "./turn";

const message = (
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
	createdAt: "2026-10-06T10:00:00.000Z",
	...partial,
});

describe("applyEvent", () => {
	test("builds a turn from its events", () => {
		const events: AssistantEvent[] = [
			{ type: "message", messageId: "m1", role: "user" },
			{
				type: "tool_start",
				toolCallId: "c1",
				name: "list_time_entries",
				arguments: "{}",
			},
			{ type: "tool_result", toolCallId: "c1", name: "x", ok: true },
			{ type: "delta", text: "You logged " },
			{ type: "delta", text: "**7.5h**." },
			{ type: "title", title: "Hours" },
			{ type: "done" },
		];
		const run = events.reduce(applyEvent, startRun("How much?"));
		expect(run.sentMessageId).toBe("m1");
		expect(run.text).toBe("You logged **7.5h**.");
		expect(run.streamed).toBe(true);
		expect(run.traces).toEqual([
			{
				toolCallId: "c1",
				name: "list_time_entries",
				ok: true,
				arguments: "{}",
			},
		]);
		expect(run.pending).toBeNull();
	});

	test("an assistant message event is not the receipt", () => {
		const run = applyEvent(startRun("Hi"), {
			type: "message",
			messageId: "a1",
			role: "assistant",
		});
		expect(run.sentMessageId).toBeNull();
	});

	test("keeps the approval and the error", () => {
		const events: AssistantEvent[] = [
			{
				type: "approval_required",
				messageId: "a1",
				toolCallId: "c9",
				name: "delete_time_entry",
				summary: "Delete 1.00h on 2026-10-05",
				arguments: '{"id":"e1"}',
				preview: null,
				selectable: false,
			},
			{ type: "error", message: "Too many messages in a minute." },
		];
		const run = events.reduce(applyEvent, startRun(null));
		expect(run.pending?.summary).toBe("Delete 1.00h on 2026-10-05");
		expect(run.error).toBe("Too many messages in a minute.");
	});
});

describe("storedPending", () => {
	const preview = {
		columns: ["Date"],
		rows: [{ id: "r1", cells: ["2026-10-05"] }],
		note: null,
		selectable: true,
	};

	test("finds the call that no tool row answers", () => {
		const pending = storedPending([
			message({ id: "u1", role: "user", content: "File them" }),
			message({
				id: "a1",
				role: "assistant",
				pendingApproval: true,
				approvalSummary: "File 1 entry",
				approvalPreview: preview,
				toolCalls: [
					{ id: "c1", name: "list_projects", arguments: "{}" },
					{ id: "c2", name: "file_time_entries", arguments: "{}" },
				],
			}),
			message({ id: "t1", role: "tool", toolCallId: "c1" }),
		]);
		expect(pending).toMatchObject({
			toolCallId: "c2",
			summary: "File 1 entry",
			selectable: true,
		});
	});

	test("is null once every call has its answer", () => {
		expect(
			storedPending([
				message({
					id: "a1",
					role: "assistant",
					pendingApproval: true,
					toolCalls: [{ id: "c1", name: "x", arguments: "{}" }],
				}),
				message({ id: "t1", role: "tool", toolCallId: "c1" }),
			]),
		).toBeNull();
	});
});

test("visibleMessages hides tool rows and empty assistant rows", () => {
	const rows = visibleMessages([
		message({ id: "u1", role: "user", content: "Hi" }),
		message({ id: "a1", role: "assistant", content: "" }),
		message({ id: "t1", role: "tool", content: "{}" }),
		message({ id: "a2", role: "assistant", content: "Hello" }),
	]);
	expect(rows.map((row) => row.id)).toEqual(["u1", "a2"]);
});

describe("ranWriteTool", () => {
	const trace = (name: string) => ({
		toolCallId: name,
		name,
		ok: true,
		arguments: "{}",
	});

	test("a turn of reads wrote nothing", () => {
		expect(ranWriteTool([])).toBe(false);
		expect(
			ranWriteTool([trace("list_projects"), trace("time_report_summary")]),
		).toBe(false);
	});

	test("a write that needs no approval counts", () => {
		expect(
			ranWriteTool([trace("list_projects"), trace("create_time_entry")]),
		).toBe(true);
		expect(ranWriteTool([trace("sync_now")])).toBe(true);
	});

	test("an approved delete counts", () => {
		expect(ranWriteTool([trace("delete_time_entry")])).toBe(true);
	});

	test("a tool that is not known counts", () => {
		expect(ranWriteTool([trace("a_new_tool")])).toBe(true);
	});
});

describe("visiblePending", () => {
	const waiting = [
		message({ id: "u1", role: "user", content: "Delete it" }),
		message({
			id: "a1",
			role: "assistant",
			pendingApproval: true,
			toolCalls: [{ id: "c1", name: "delete_time_entry", arguments: "{}" }],
		}),
	];

	test("shows the stored card when no turn runs", () => {
		expect(visiblePending(IDLE, waiting)?.toolCallId).toBe("c1");
	});

	test("hides the stored card while the answer streams", () => {
		expect(visiblePending(startRun(null), waiting)).toBeNull();
	});

	test("hides the stored card after the turn ran a tool", () => {
		const run = {
			...IDLE,
			traces: [
				{
					toolCallId: "c1",
					name: "delete_time_entry",
					ok: true,
					arguments: "{}",
				},
			],
		};
		expect(visiblePending(run, waiting)).toBeNull();
	});

	test("shows the stored card again when the turn failed at once", () => {
		expect(
			visiblePending({ ...IDLE, error: "Offline" }, waiting)?.toolCallId,
		).toBe("c1");
	});

	test("prefers the card of the live run", () => {
		const run = applyEvent(startRun(null), {
			type: "approval_required",
			messageId: "a2",
			toolCallId: "c2",
			name: "archive_task",
			summary: "Archive it",
			arguments: "{}",
			preview: null,
			selectable: false,
		});
		expect(visiblePending(run, waiting)?.toolCallId).toBe("c2");
	});
});
