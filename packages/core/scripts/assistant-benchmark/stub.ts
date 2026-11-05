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

/** What one scripted question reads: the date, the question and the tool
 *  results so far. */
type Scene = {
	model: string;
	ask: string;
	today: string;
	yesterday: string;
	thisWeek: string;
	lastMonthStart: string;
	/** The number of tool results so far. The stub asks for one tool at a time. */
	step: number;
	result: (index: number) => string;
};

const hoursLogged = (s: Scene): ChatTurn => {
	const range = s.ask.toLowerCase().includes("last week")
		? { from: addDaysToKey(s.thisWeek, -7), to: addDaysToKey(s.thisWeek, -1) }
		: { from: s.lastMonthStart, to: endOfMonthKey(s.lastMonthStart) };
	if (s.step === 0) return call("whoami", {}, s.model);
	if (s.step === 1) {
		const me: { userId: string } = JSON.parse(s.result(0));
		return call(
			"time_report_summary",
			{ ...range, tab: "teammates", userId: me.userId },
			s.model,
		);
	}
	const summary: Summary = JSON.parse(s.result(1));
	return turn({ content: `You logged ${summary.totalHours} hours.` }, s.model);
};

const deltaAnalytics = (s: Scene): ChatTurn => {
	if (s.step === 0) return call("list_projects", {}, s.model);
	if (s.step === 1) {
		const projects: Named[] = JSON.parse(s.result(0));
		return call(
			"time_report_summary",
			{
				from: s.lastMonthStart,
				to: endOfMonthKey(s.lastMonthStart),
				tab: "projects",
				projectId: projects.find((p) => p.name === "Delta Analytics")?.id ?? "",
			},
			s.model,
		);
	}
	const summary: Summary = JSON.parse(s.result(1));
	return turn({ content: `${summary.totalHours} hours.` }, s.model);
};

const overtime = (s: Scene): ChatTurn => {
	if (s.step === 0) {
		return call(
			"overtime_report",
			{ from: addDaysToKey(s.today, -60), to: s.today },
			s.model,
		);
	}
	const report: Overtime = JSON.parse(s.result(0));
	const top = [...report.rows].sort((a, b) => b.hours - a.hours)[0];
	return turn({ content: `${top?.name}, ${top?.hours} hours.` }, s.model);
};

const vacationDays = (s: Scene): ChatTurn => {
	if (s.step === 0) {
		return call(
			"absence_report",
			{ from: addDaysToKey(s.today, -60), to: s.today },
			s.model,
		);
	}
	const report: Absence = JSON.parse(s.result(0));
	const name = s.ask.replace(/^How many vacation days has (.*) taken.*$/, "$1");
	const hours = report.rows.find((row) => row.name === name)?.hours ?? 0;
	return turn({ content: `${hours / 8} days of vacation.` }, s.model);
};

const logTwoHours = (s: Scene): ChatTurn => {
	if (s.step === 0) return call("list_projects", {}, s.model);
	if (s.step === 1) return call("list_tasks", {}, s.model);
	if (s.step === 2) {
		const projects: Named[] = JSON.parse(s.result(0));
		const tasks: Named[] = JSON.parse(s.result(1));
		return call(
			"create_time_entry",
			{
				date: s.yesterday,
				projectId: projects.find((p) => p.name === "Atlas Platform")?.id ?? "",
				taskId: tasks.find((t) => t.name === "Development")?.id ?? "",
				durationSeconds: 7200,
				description: "code review",
			},
			s.model,
		);
	}
	return turn({ content: "I logged 2 hours." }, s.model);
};

const changeDescription = (s: Scene): ChatTurn => {
	if (s.step === 0) {
		return call(
			"list_time_entries",
			{ from: s.yesterday, to: s.yesterday },
			s.model,
		);
	}
	if (s.step === 1) {
		const entries: Entries = JSON.parse(s.result(0));
		return call(
			"update_entry_description",
			{
				timeEntryId: entries[0]?.id ?? "",
				description: "Reviewed the export PR",
			},
			s.model,
		);
	}
	return turn({ content: "I changed the description." }, s.model);
};

const vacationDay = (s: Scene): ChatTurn => {
	if (s.step === 0) return call("list_tasks", {}, s.model);
	const tasks: (Named & { isAbsence: boolean })[] = JSON.parse(s.result(0));
	return call(
		"log_absence",
		{
			taskId: tasks.find((t) => t.name === "Vacation")?.id ?? "",
			from: addDaysToKey(s.thisWeek, 7),
			to: addDaysToKey(s.thisWeek, 7),
		},
		s.model,
	);
};

const farmerRepo = (s: Scene): ChatTurn => {
	if (s.step === 0) {
		return call(
			"list_attached_commits",
			{ from: s.yesterday, to: s.yesterday, repository: TARGET_REPO },
			s.model,
		);
	}
	const found: Commits = JSON.parse(s.result(0));
	return call(
		"unlink_commits",
		{
			attachmentIds: found.commits
				.filter((row) => row.repository === TARGET_REPO)
				.map((row) => row.attachmentId),
		},
		s.model,
	);
};

const whatIsMissing = (s: Scene): ChatTurn => {
	if (s.step === 0) return call("suggest_day", { date: s.yesterday }, s.model);
	return turn({ content: "Add a break and a block of work." }, s.model);
};

/** The first phrase found in the question picks the script. "vacation days"
 *  comes before "vacation day", because the second is inside the first. */
const scripts: [phrase: string, script: (s: Scene) => ChatTurn][] = [
	["how many hours did i log", hoursLogged],
	["delta analytics", deltaAnalytics],
	["overtime", overtime],
	["vacation days", vacationDays],
	["log 2 hours", logTwoHours],
	["change the description", changeDescription],
	["vacation day", vacationDay],
	["farmer repo", farmerRepo],
	["what is missing", whatIsMissing],
];

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
		const today = /Today is (\d{4}-\d{2}-\d{2})/.exec(
			text(opts.messages[0]),
		)?.[1];
		if (!today) throw new Error("The stub found no date in the prompt.");
		const results = opts.messages.filter((m) => m.role === "tool").map(text);
		const scene: Scene = {
			model: opts.model,
			ask,
			today,
			yesterday: addDaysToKey(today, -1),
			thisWeek: startOfWeekKey(today, 1),
			lastMonthStart: startOfMonthKey(addDaysToKey(startOfMonthKey(today), -1)),
			step: results.length,
			result: (index) => results[index] ?? "{}",
		};
		const lower = ask.toLowerCase();
		const match = scripts.find(([phrase]) => lower.includes(phrase));
		if (!match) throw new Error(`The stub has no script for: ${ask}`);
		return match[1](scene);
	};
	return {
		streamChatCompletion: stream,
		listModels: async () => [],
		verifyKey: async () => undefined,
	};
};
