// One model, all questions, all repeats, in one process.
//
// The runner starts one child for each model. A child needs its own process,
// because `ASSISTANT_FALLBACK_MODEL` and the telemetry sink are global. Run it
// by hand for one model:
//
//   OPENROUTER_API_KEY=... bun scripts/assistant-benchmark/child.ts --model z-ai/glm-5.3-flash
//
// The child prints one `@@RUN {json}` line for each finished run.

import { parseArgs } from "node:util";

import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import {
	assistantConversation,
	assistantSettings,
} from "../../src/db/schema/assistant";
import { sealSecret } from "../../src/lib/secret-box";
import {
	type AiGeneration,
	type AiSpan,
	setAiTelemetrySink,
} from "../../src/services/ai-telemetry";
import {
	type AssistantEvent,
	assistantService,
	setChatModelForTests,
} from "../../src/services/assistant.service";
import { createTestDb, closeTestEngine } from "../../src/test/harness";
import { QUESTIONS, type Trace } from "./questions";
import { seedOrganization } from "./seed";
import { stubPort } from "./stub";
import { RUN_PREFIX, type RunRecord } from "./types";

// The same two settings that the test preload sets. A child is not a test.
process.env.BETTER_AUTH_SECRET ??= "benchmark-secret";
process.env.ASSISTANT_ENABLED = "true";

/** A run that lasts longer than this is a failed run. */
const RUN_TIMEOUT_MS = 300_000;

const { values } = parseArgs({
	options: {
		model: { type: "string" },
		repeats: { type: "string", default: "3" },
		questions: { type: "string", default: "" },
		done: { type: "string", default: "" },
		// USD per token, "prompt,completion". Used only when a call has no cost.
		price: { type: "string", default: "0,0" },
		stub: { type: "boolean", default: false },
	},
});
const model = values.model;
if (!model) throw new Error("Pass --model.");
const repeats = Number(values.repeats);
const wanted = new Set(values.questions?.split(",").filter(Boolean));
const done = new Set(values.done?.split(",").filter(Boolean));
const [promptPrice = 0, completionPrice = 0] = (values.price ?? "0,0")
	.split(",")
	.map(Number);

const apiKey = values.stub
	? "stub-key"
	: (process.env.OPENROUTER_API_KEY ?? "");
if (!apiKey) throw new Error("Set OPENROUTER_API_KEY.");

// The fallback retry asks the same model, so each model is measured on its own.
// A stall still counts: the telemetry shows each retry and its reason.
process.env.ASSISTANT_FALLBACK_MODEL = model;
if (values.stub) setChatModelForTests(stubPort());

const harness = await createTestDb();
const seeded = await seedOrganization();
console.error(
	`seeded ${seeded.people} people and ${seeded.entries} entries for ${seeded.today}`,
);

// The key is sealed as in production. It is never printed.
await db.insert(assistantSettings).values({
	organizationId: seeded.reader.organizationId,
	apiKey: sealSecret(apiKey),
	defaultModel: model,
	connectedByUserId: seeded.reader.userId,
});

const generations = new Map<string, AiGeneration[]>();
const spans = new Map<string, AiSpan[]>();
setAiTelemetrySink({
	generation: (event) => {
		generations.set(event.conversationId, [
			...(generations.get(event.conversationId) ?? []),
			event,
		]);
	},
	span: (event) => {
		spans.set(event.conversationId, [
			...(spans.get(event.conversationId) ?? []),
			event,
		]);
	},
});

const unique = (items: (string | null)[]): string[] => [
	...new Set(items.filter((item): item is string => item !== null)),
];

for (const question of QUESTIONS) {
	if (wanted.size > 0 && !wanted.has(question.id)) continue;
	for (let repeat = 1; repeat <= repeats; repeat += 1) {
		if (done.has(`${question.id}:${repeat}`)) continue;
		await seeded.reset();
		const ctx = question.caller === "reader" ? seeded.reader : seeded.writer;
		// A set title keeps the run from paying for a title call.
		const conversation = await assistantService.conversations.create(ctx, {
			title: "Benchmark",
		});
		const events: AssistantEvent[] = [];
		const errors: string[] = [];
		const controller = new AbortController();
		const timer = setTimeout(() => {
			errors.push(`run exceeded ${RUN_TIMEOUT_MS / 1000} s`);
			controller.abort();
		}, RUN_TIMEOUT_MS);
		const started = Date.now();
		try {
			await assistantService.run(
				ctx,
				{ conversationId: conversation.id, message: question.ask(seeded) },
				(event) => {
					events.push(event);
					if (event.type === "error") errors.push(event.message);
				},
				controller.signal,
			);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
		clearTimeout(timer);
		const wallMs = Date.now() - started;

		const calls = generations.get(conversation.id) ?? [];
		const finished = calls.filter((call) => call.error === null);
		const approvalEvent = events.find(
			(event) => event.type === "approval_required",
		);
		const trace: Trace = {
			answer: finished.at(-1)?.outputText ?? "",
			calls: finished.flatMap((call) =>
				call.toolCalls.map((tool) => ({
					name: tool.name,
					arguments: tool.arguments,
				})),
			),
			executed: (spans.get(conversation.id) ?? []).map((span) => ({
				name: span.name,
				input: span.inputState,
				ok: span.ok,
			})),
			approval: approvalEvent
				? { name: approvalEvent.name, arguments: approvalEvent.arguments }
				: null,
		};
		const verdict =
			errors.length > 0
				? { pass: false, reason: `error: ${errors[0]}` }
				: question.check(trace, seeded);

		// A call with no tokens and no cost, such as a stall, is a true zero.
		const estimated = calls.some(
			(call) =>
				call.costUsd === null &&
				(call.inputTokens ?? 0) + (call.outputTokens ?? 0) > 0,
		);
		const costUsd = calls.reduce(
			(sum, call) =>
				sum +
				(call.costUsd ??
					(call.inputTokens ?? 0) * promptPrice +
						(call.outputTokens ?? 0) * completionPrice),
			0,
		);
		const record: RunRecord = {
			model,
			question: question.id,
			repeat,
			pass: verdict.pass,
			reason: verdict.reason,
			steps: calls.filter((call) => call.attempt === 1 && call.step !== null)
				.length,
			ceiling: calls.some((call) => call.step === null),
			toolCalls: trace.calls,
			approval: trace.approval,
			wallMs,
			firstProgressMs: calls.flatMap((call) =>
				call.firstProgressMs === null ? [] : [call.firstProgressMs],
			),
			stalls: calls.filter((call) => call.retryReason === "stall").length,
			retries: calls.filter((call) => call.retryReason !== null).length,
			retryReasons: unique(calls.map((call) => call.retryReason)),
			errors,
			costUsd,
			costEstimated: estimated,
			inputTokens: calls.reduce(
				(sum, call) => sum + (call.inputTokens ?? 0),
				0,
			),
			outputTokens: calls.reduce(
				(sum, call) => sum + (call.outputTokens ?? 0),
				0,
			),
			servedModels: unique(calls.map((call) => call.servedModel)),
			providers: unique(calls.map((call) => call.provider)),
			answer: trace.answer.slice(0, 2000),
		};
		console.log(`${RUN_PREFIX}${JSON.stringify(record)}`);
		// The thread is not needed again, and a delete keeps the child small.
		await db
			.delete(assistantConversation)
			.where(eq(assistantConversation.id, conversation.id));
	}
}

await harness.close();
await closeTestEngine();
process.exit(0);
