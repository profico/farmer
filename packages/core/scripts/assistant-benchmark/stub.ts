// A scripted model, to prove that the harness works without a paid call.
//
// It replaces the network client only. The loop, the tool registry, the system
// prompt, the retry and the telemetry are the real ones. The scripted model
// acts as a correct model would. It reads the ids and the figures from the
// real tool results, and it calls the tools that each question needs. So a
// stub run shows that every question can pass through the real loop.
//
// The first call of the process stalls with no output, so the stall count and
// the retry can be seen.

import type { JsonRecord } from "../../src/lib/json";
import {
	type ChatMessage,
	type ChatTurn,
	OpenRouterStreamCutError,
	type streamChatCompletion,
} from "../../src/lib/openrouter-client";
import {
	addDaysToKey,
	endOfMonthKey,
	startOfMonthKey,
	startOfWeekKey,
} from "../../src/lib/time";
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

const call = (name: string, args: JsonRecord, model: string): ChatTurn =>
	turn(
		{
			toolCalls: [
				{ id: `call-${name}`, name, arguments: JSON.stringify(args) },
			],
		},
		model,
	);

type Named = { id: string; name: string };
type Summary = { totalHours: number };
type Overtime = { rows: { name: string; hours: number }[] };
type Absence = { rows: { name: string; hours: number }[] };
type Commits = {
	commits: { attachmentId: string; repository: string | null }[];
};
type Entries = { id: string }[];

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
		const { model } = opts;
		const ask = text(opts.messages.find((m) => m.role === "user"));
		const today = /Today is (\d{4}-\d{2}-\d{2})/.exec(
			text(opts.messages[0]),
		)?.[1];
		if (!today) throw new Error("The stub found no date in the prompt.");
		const yesterday = addDaysToKey(today, -1);
		const thisWeek = startOfWeekKey(today, 1);
		const lastMonthStart = startOfMonthKey(
			addDaysToKey(startOfMonthKey(today), -1),
		);
		const results = opts.messages.filter((m) => m.role === "tool").map(text);
		// The step is the number of tool results so far. The stub asks for one
		// tool at a time.
		const step = results.length;
		const result = (index: number) => results[index] ?? "{}";
		const words = (line: string) => ask.toLowerCase().includes(line);

		if (words("how many hours did i log")) {
			const range = words("last week")
				? { from: addDaysToKey(thisWeek, -7), to: addDaysToKey(thisWeek, -1) }
				: { from: lastMonthStart, to: endOfMonthKey(lastMonthStart) };
			if (step === 0) return call("whoami", {}, model);
			if (step === 1) {
				const me: { userId: string } = JSON.parse(result(0));
				return call(
					"time_report_summary",
					{ ...range, tab: "teammates", userId: me.userId },
					model,
				);
			}
			const summary: Summary = JSON.parse(result(1));
			return turn(
				{ content: `You logged ${summary.totalHours} hours.` },
				model,
			);
		}
		if (words("delta analytics")) {
			if (step === 0) return call("list_projects", {}, model);
			if (step === 1) {
				const projects: Named[] = JSON.parse(result(0));
				return call(
					"time_report_summary",
					{
						from: lastMonthStart,
						to: endOfMonthKey(lastMonthStart),
						tab: "projects",
						projectId:
							projects.find((p) => p.name === "Delta Analytics")?.id ?? "",
					},
					model,
				);
			}
			const summary: Summary = JSON.parse(result(1));
			return turn({ content: `${summary.totalHours} hours.` }, model);
		}
		if (words("overtime")) {
			if (step === 0) {
				return call(
					"overtime_report",
					{ from: addDaysToKey(today, -60), to: today },
					model,
				);
			}
			const report: Overtime = JSON.parse(result(0));
			const top = [...report.rows].sort((a, b) => b.hours - a.hours)[0];
			return turn({ content: `${top?.name}, ${top?.hours} hours.` }, model);
		}
		if (words("vacation days")) {
			if (step === 0) {
				return call(
					"absence_report",
					{ from: addDaysToKey(today, -60), to: today },
					model,
				);
			}
			const report: Absence = JSON.parse(result(0));
			const name = ask.replace(
				/^How many vacation days has (.*) taken.*$/,
				"$1",
			);
			const hours = report.rows.find((row) => row.name === name)?.hours ?? 0;
			return turn({ content: `${hours / 8} days of vacation.` }, model);
		}
		if (words("log 2 hours")) {
			if (step === 0) return call("list_projects", {}, model);
			if (step === 1) return call("list_tasks", {}, model);
			if (step === 2) {
				const projects: Named[] = JSON.parse(result(0));
				const tasks: Named[] = JSON.parse(result(1));
				return call(
					"create_time_entry",
					{
						date: yesterday,
						projectId:
							projects.find((p) => p.name === "Atlas Platform")?.id ?? "",
						taskId: tasks.find((t) => t.name === "Development")?.id ?? "",
						durationSeconds: 7200,
						description: "code review",
					},
					model,
				);
			}
			return turn({ content: "I logged 2 hours." }, model);
		}
		if (words("change the description")) {
			if (step === 0) {
				return call(
					"list_time_entries",
					{ from: yesterday, to: yesterday },
					model,
				);
			}
			if (step === 1) {
				const entries: Entries = JSON.parse(result(0));
				return call(
					"update_entry_description",
					{
						timeEntryId: entries[0]?.id ?? "",
						description: "Reviewed the export PR",
					},
					model,
				);
			}
			return turn({ content: "I changed the description." }, model);
		}
		if (words("vacation day")) {
			if (step === 0) return call("list_tasks", {}, model);
			const tasks: (Named & { isAbsence: boolean })[] = JSON.parse(result(0));
			return call(
				"log_absence",
				{
					taskId: tasks.find((t) => t.name === "Vacation")?.id ?? "",
					from: addDaysToKey(thisWeek, 7),
					to: addDaysToKey(thisWeek, 7),
				},
				model,
			);
		}
		if (words("farmer repo")) {
			if (step === 0) {
				return call(
					"list_attached_commits",
					{ from: yesterday, to: yesterday, repository: TARGET_REPO },
					model,
				);
			}
			const found: Commits = JSON.parse(result(0));
			return call(
				"unlink_commits",
				{
					attachmentIds: found.commits
						.filter((row) => row.repository === TARGET_REPO)
						.map((row) => row.attachmentId),
				},
				model,
			);
		}
		if (words("what is missing")) {
			if (step === 0) return call("suggest_day", { date: yesterday }, model);
			return turn({ content: "Add a break and a block of work." }, model);
		}
		throw new Error(`The stub has no script for: ${ask}`);
	};
	return {
		streamChatCompletion: stream,
		listModels: async () => [],
		verifyKey: async () => undefined,
	};
};
