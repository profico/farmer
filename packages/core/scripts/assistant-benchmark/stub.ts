// A scripted model, to prove that the harness works without a paid call.
//
// It replaces the network client only. The loop, the tool registry, the system
// prompt, the retry and the telemetry are the real ones. The first call of the
// process stalls with no output, so the stall count and the retry can be seen.

import {
	type ChatMessage,
	type ChatTurn,
	OpenRouterStreamCutError,
	type streamChatCompletion,
} from "../../src/lib/openrouter-client";
import type { ChatModelPort } from "../../src/services/assistant.service";
import { TARGET_REPO } from "./seed";

const empty: ChatTurn = {
	content: "",
	toolCalls: [],
	promptTokens: null,
	completionTokens: null,
	costUsd: null,
	finishReason: null,
};

const text = (message: ChatMessage | undefined): string =>
	message && "content" in message ? message.content : "";

const turn = (partial: Partial<ChatTurn>, model: string): ChatTurn => ({
	...empty,
	promptTokens: 1000,
	completionTokens: 50,
	costUsd: 0.0001,
	finishReason: partial.toolCalls?.length ? "tool_calls" : "stop",
	servedModel: `stub/${model}`,
	provider: "Stub",
	firstProgressMs: 5,
	...partial,
});

const attachmentIds = (raw: string): string[] => {
	try {
		const rows: {
			commits?: { attachmentId: string; repository: string | null }[];
		} = JSON.parse(raw);
		return (rows.commits ?? [])
			.filter((row) => row.repository === TARGET_REPO)
			.map((row) => row.attachmentId);
	} catch {
		return [];
	}
};

export const stubPort = (): ChatModelPort => {
	let calls = 0;
	const stream: typeof streamChatCompletion = async (opts) => {
		calls += 1;
		await new Promise((resolve) => setTimeout(resolve, 5));
		if (calls === 1) {
			throw new OpenRouterStreamCutError(empty, null, false, false, {
				stalled: true,
				outputStarted: false,
			});
		}
		const ask = text(opts.messages.find((m) => m.role === "user"));
		const system = text(opts.messages[0]);
		const day = /Today is (\d{4}-\d{2}-\d{2})/.exec(system)?.[1] ?? "";
		const yesterday = new Date(`${day}T00:00:00Z`);
		yesterday.setUTCDate(yesterday.getUTCDate() - 1);
		const date = yesterday.toISOString().slice(0, 10);
		const tools = opts.messages.filter((m) => m.role === "tool");
		const last = text(tools.at(-1));

		if (ask.includes("farmer repo")) {
			if (tools.length === 0) {
				return turn(
					{
						toolCalls: [
							{
								id: "call-1",
								name: "list_attached_commits",
								arguments: JSON.stringify({
									from: date,
									to: date,
									repository: TARGET_REPO,
								}),
							},
						],
					},
					opts.model,
				);
			}
			return turn(
				{
					toolCalls: [
						{
							id: "call-2",
							name: "unlink_commits",
							arguments: JSON.stringify({ attachmentIds: attachmentIds(last) }),
						},
					],
				},
				opts.model,
			);
		}
		if (tools.length === 0) {
			return turn(
				{ toolCalls: [{ id: "call-1", name: "whoami", arguments: "{}" }] },
				opts.model,
			);
		}
		return turn({ content: "Stub answer: 1.00 hours." }, opts.model);
	};
	return {
		streamChatCompletion: stream,
		listModels: async () => [],
		verifyKey: async () => undefined,
	};
};
