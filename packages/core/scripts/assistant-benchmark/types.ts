// The record that one benchmark run writes. The child process prints it, the
// runner stores it, and the report reads it.

import { z } from "zod";

export const runRecordSchema = z.object({
	model: z.string(),
	question: z.string(),
	repeat: z.number().int(),
	pass: z.boolean(),
	reason: z.string(),
	/** Model calls that answered a step, not counting a retry or the closing call. */
	steps: z.number().int(),
	/** True when the loop used every step and made the closing call. */
	ceiling: z.boolean(),
	toolCalls: z.array(z.object({ name: z.string(), arguments: z.string() })),
	approval: z.object({ name: z.string(), arguments: z.string() }).nullable(),
	wallMs: z.number(),
	/** One value for each model call that streamed some progress. */
	firstProgressMs: z.array(z.number()),
	stalls: z.number().int(),
	retries: z.number().int(),
	retryReasons: z.array(z.string()),
	errors: z.array(z.string()),
	costUsd: z.number(),
	/** True when OpenRouter sent no cost and the figure comes from the price list. */
	costEstimated: z.boolean(),
	inputTokens: z.number().int(),
	outputTokens: z.number().int(),
	servedModels: z.array(z.string()),
	providers: z.array(z.string()),
	answer: z.string(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

/** The line that the child prints for each run. */
export const RUN_PREFIX = "@@RUN ";
