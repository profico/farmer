/**
 * The answers of the routes for the assistant. The rules of
 * `schemas.ts` apply: an unknown field is dropped, and a value from an open
 * set is read as a string.
 */

import { z } from "zod";

import type { Expect, Parses } from "./contract";
import type { components } from "./openapi.gen";

type Schemas = components["schemas"];

export const assistantSettingsSchema = z.object({
	/**
	 * False when the deployment has the assistant switched off. The thread
	 * routes then answer 404.
	 */
	available: z.boolean(),
	/** A usable key is stored. */
	configured: z.boolean(),
	/** A key is stored and does not decrypt. Paste it again. */
	keyUnreadable: z.boolean(),
	/** False when an admin paused the assistant here. */
	enabled: z.boolean(),
	defaultModel: z.string().nullable(),
	/** The first characters of the key. Never the key. */
	keyHint: z.string().nullable(),
	systemPrompt: z.string().nullable(),
	/** An instant, ISO 8601 in UTC. */
	connectedAt: z.string().nullable(),
});
export type AssistantSettings = z.output<typeof assistantSettingsSchema>;

export const assistantModelSchema = z.object({
	id: z.string(),
	name: z.string(),
	contextLength: z.number().nullable(),
	/** USD per million prompt tokens. */
	promptPrice: z.number().nullable(),
	supportsTools: z.boolean(),
});
export type AssistantModel = z.output<typeof assistantModelSchema>;

export const assistantThreadSchema = z.object({
	id: z.string(),
	title: z.string(),
	model: z.string(),
	/** An instant, ISO 8601 in UTC. */
	updatedAt: z.string(),
	/** When the owner shared the thread. Null: not shared. */
	sharedAt: z.string().nullable(),
});
export type AssistantThread = z.output<typeof assistantThreadSchema>;

export const assistantSearchHitSchema = z.object({
	id: z.string(),
	title: z.string(),
	updatedAt: z.string(),
	/** Plain text around the first match. Null when only the title matched. */
	snippet: z.string().nullable(),
});
export type AssistantSearchHit = z.output<typeof assistantSearchHitSchema>;

export const assistantShareSchema = z.object({
	/** Null after the share stopped. */
	sharedAt: z.string().nullable(),
});
export type AssistantShare = z.output<typeof assistantShareSchema>;

export const assistantMessageSchema = z.object({
	id: z.string(),
	role: z.string(),
	content: z.string(),
	toolCalls: z
		.array(
			z.object({
				id: z.string(),
				name: z.string(),
				/** The raw JSON the model sent. */
				arguments: z.string(),
			}),
		)
		.nullable(),
	/** On a `tool` row: the call it answers. */
	toolCallId: z.string().nullable(),
	toolName: z.string().nullable(),
	/**
	 * A card waits for an answer. The waiting call is the one in `toolCalls`
	 * that no `tool` row answers.
	 */
	pendingApproval: z.boolean(),
	approvalDecision: z.string().nullable(),
	approvalSummary: z.string().nullable(),
	approvalPreview: z
		.object({
			columns: z.array(z.string()),
			rows: z.array(
				z.object({
					id: z.string(),
					cells: z.array(z.string()),
				}),
			),
			note: z.string().nullable(),
			selectable: z.boolean(),
		})
		.nullable(),
	/** A `tool` row whose write can still be undone. */
	undoable: z.boolean(),
	/** The person undid this write. */
	undone: z.boolean(),
	/** A `tool` row whose write ran and still stands. */
	changed: z.boolean(),
	/** An instant, ISO 8601 in UTC. */
	createdAt: z.string(),
});
export type AssistantMessage = z.output<typeof assistantMessageSchema>;

export const assistantRewindSchema = z.object({
	/** The text of the removed question, to send again. */
	content: z.string(),
});
export type AssistantRewind = z.output<typeof assistantRewindSchema>;

export const assistantThreadDetailSchema = z.object({
	thread: assistantThreadSchema,
	/** Oldest first. */
	messages: z.array(assistantMessageSchema),
	/** Prompt tokens of the last model call. Null before the first answer. */
	promptTokens: z.number().nullable(),
	/** Context size of the thread's model. Null when unknown. */
	contextLength: z.number().nullable(),
});
export type AssistantThreadDetail = z.output<
	typeof assistantThreadDetailSchema
>;

export const assistantSharedThreadSchema = z.object({
	thread: assistantThreadSchema,
	/** Oldest first. */
	messages: z.array(assistantMessageSchema),
	/** An instant, ISO 8601 in UTC. */
	sharedAt: z.string(),
	sharedBy: z.object({ name: z.string(), image: z.string().nullable() }),
});
export type AssistantSharedThread = z.output<
	typeof assistantSharedThreadSchema
>;

/**
 * One Server-Sent Event: each `data:` line is one of these, as JSON. The turn
 * ends after `done` or `error`.
 */
export const assistantEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("message"),
		messageId: z.string(),
		role: z.string(),
	}),
	z.object({
		type: z.literal("delta"),
		text: z.string(),
	}),
	z.object({
		type: z.literal("tool_start"),
		toolCallId: z.string(),
		name: z.string(),
		arguments: z.string(),
	}),
	z.object({
		type: z.literal("tool_result"),
		toolCallId: z.string(),
		name: z.string(),
		ok: z.boolean(),
	}),
	z.object({
		type: z.literal("approval_required"),
		messageId: z.string(),
		toolCallId: z.string(),
		name: z.string(),
		summary: z.string(),
		arguments: z.string(),
		preview: z
			.object({
				columns: z.array(z.string()),
				rows: z.array(
					z.object({
						id: z.string(),
						cells: z.array(z.string()),
					}),
				),
				note: z.string().optional(),
			})
			.nullable(),
		selectable: z.boolean(),
	}),
	z.object({
		type: z.literal("title"),
		title: z.string(),
	}),
	z.object({
		type: z.literal("done"),
	}),
	z.object({
		type: z.literal("error"),
		message: z.string(),
	}),
]);
export type AssistantEvent = z.output<typeof assistantEventSchema>;

// Each answer the document describes must parse with the schema above.
export type AssistantContractChecks = [
	Expect<Parses<Schemas["AssistantSettings"], typeof assistantSettingsSchema>>,
	Expect<Parses<Schemas["AssistantModel"], typeof assistantModelSchema>>,
	Expect<Parses<Schemas["AssistantThread"], typeof assistantThreadSchema>>,
	Expect<Parses<Schemas["AssistantMessage"], typeof assistantMessageSchema>>,
	Expect<Parses<Schemas["AssistantRewind"], typeof assistantRewindSchema>>,
	Expect<
		Parses<Schemas["AssistantSearchHit"], typeof assistantSearchHitSchema>
	>,
	Expect<Parses<Schemas["AssistantShare"], typeof assistantShareSchema>>,
	Expect<
		Parses<Schemas["AssistantSharedThread"], typeof assistantSharedThreadSchema>
	>,
	Expect<
		Parses<Schemas["AssistantThreadDetail"], typeof assistantThreadDetailSchema>
	>,
	Expect<Parses<Schemas["AssistantEvent"], typeof assistantEventSchema>>,
];
