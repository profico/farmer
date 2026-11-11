import { z } from "zod";

// Admin-set org credentials. The key is write-only from the client's side: it
// goes in here and never comes back out (assistantService.settings.get returns
// a masked hint), matching how the Slack bot token is handled.
export const setAssistantSettingsInput = z.object({
	// OpenRouter keys are `sk-or-v1-…`; the prefix is checked so a pasted
	// OpenAI/Anthropic key fails here with a useful message rather than as a 401
	// on the user's first question.
	apiKey: z
		.string()
		.trim()
		.min(20, "That doesn't look like an OpenRouter key")
		.max(400)
		.refine((value) => value.startsWith("sk-or-"), {
			message: "OpenRouter keys start with sk-or-",
		}),
	defaultModel: z.string().trim().min(1).max(200),
});
export type SetAssistantSettingsInput = z.infer<
	typeof setAssistantSettingsInput
>;

/** The ceiling on an org's added house rules.
 *
 *  ~1k tokens, and it rides on every turn of every conversation in the org, so
 *  the cost of a long one is paid forever and by everybody. Generous enough for
 *  a page of real conventions, tight enough that nobody pastes a handbook. */
export const MAX_SYSTEM_PROMPT_CHARS = 4000;

export const updateAssistantSettingsInput = z.object({
	defaultModel: z.string().trim().min(1).max(200).optional(),
	enabled: z.boolean().optional(),
	// Nullable as well as optional, and the two mean different things: absent
	// leaves the stored rules alone, null clears them. Without the distinction
	// the "off" switch and a save with an empty box would be indistinguishable
	// from "don't touch it".
	systemPrompt: z
		.string()
		.trim()
		.max(
			MAX_SYSTEM_PROMPT_CHARS,
			`Keep house rules under ${MAX_SYSTEM_PROMPT_CHARS} characters`,
		)
		.nullable()
		.optional(),
});
export type UpdateAssistantSettingsInput = z.infer<
	typeof updateAssistantSettingsInput
>;

// Deliberately carries no `model`. Choosing one is an admin decision made once,
// in Settings → AI, and a conversation pins whatever the org default
// was when it started. An optional field here that nothing sends would be a
// caller-supplied override of that decision sitting unused until somebody found
// it — which is the same shape as every other input that quietly became a hole.
export const createConversationInput = z.object({
	/** Optional: the composer creates the thread and sends in one gesture. */
	title: z.string().trim().max(200).optional(),
});
export type CreateConversationInput = z.infer<typeof createConversationInput>;

export const renameConversationInput = z.object({
	conversationId: z.uuid(),
	title: z.string().trim().min(1, "Give it a name").max(200),
});
export type RenameConversationInput = z.infer<typeof renameConversationInput>;

export const conversationIdInput = z.object({ conversationId: z.uuid() });
export type ConversationIdInput = z.infer<typeof conversationIdInput>;

/** One stored message of one of the caller's threads. */
export const assistantMessageIdInput = z.object({
	conversationId: z.uuid(),
	messageId: z.uuid(),
});

/** What a person types to the assistant. */
export const assistantMessageText = z.string().trim().min(1).max(10_000);

/** The answer to a write the assistant asked permission for. */
export const assistantResolveInput = z.object({
	toolCallId: z.string().min(1).max(200),
	decision: z.enum(["approved", "rejected"]),
	// Which rows of a batch the person actually ticked (see
	// `ApprovalPreview` in assistant-tools.ts). Absent means the whole
	// call, which is what every non-batch approval sends and what a
	// client that predates this field sends. An EMPTY array is a real
	// and different answer — "none of them" — and is handled as a
	// rejection rather than as a write of nothing.
	selectedRowIds: z.array(z.string().min(1).max(200)).max(200).optional(),
});
export type AssistantResolveInput = z.infer<typeof assistantResolveInput>;

/** The body of `POST /api/v1/orgs/$slug/assistant/threads/$id/messages`. The
 *  thread comes from the path. */
export const assistantSendInput = z.object({ message: assistantMessageText });

// One turn. Either a new user message, or the resolution of a write the
// assistant asked permission for — never both, because they are two different
// things to do with the same suspended conversation and accepting both would
// leave "approve this AND also here's a new question" ordering undefined.
export const runAssistantInput = z
	.object({
		conversationId: z.uuid(),
		message: assistantMessageText.optional(),
		resolve: assistantResolveInput.optional(),
	})
	.refine((data) => Boolean(data.message) !== Boolean(data.resolve), {
		message: "Send either a message or an approval decision",
		path: ["message"],
	});
export type RunAssistantInput = z.infer<typeof runAssistantInput>;

export const MIN_SEARCH_CHARS = 2;
export const MAX_SEARCH_CHARS = 100;

export const searchConversationsInput = z.object({
	q: z.string().trim().min(MIN_SEARCH_CHARS).max(MAX_SEARCH_CHARS),
});
export type SearchConversationsInput = z.infer<typeof searchConversationsInput>;
