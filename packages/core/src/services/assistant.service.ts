import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import {
	type AssistantToolCall,
	assistantConversation,
	assistantMessage,
	assistantSettings,
} from "../db/schema/assistant";
import { isAssistantEnabled } from "../lib/assistant-flag";
import type { JsonRecord, Serializable } from "../lib/json";
import {
	type ChatMessage,
	type ChatTurn,
	listModels as listOpenRouterModels,
	OpenRouterError,
	type OpenRouterModel,
	streamChatCompletion,
	verifyKey,
} from "../lib/openrouter-client";
import { dayKeyInTz } from "../lib/time";
import type {
	CreateConversationInput,
	RenameConversationInput,
	RunAssistantInput,
	SetAssistantSettingsInput,
	UpdateAssistantSettingsInput,
} from "../schema";
import {
	type ApprovalPreview,
	findTool,
	systemPrompt,
	toolDefinitions,
} from "./assistant-tools";
import { ctxAccess, ctxTimezone, requireAdmin } from "./context";
import type { Ctx } from "./types";

export class AssistantError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AssistantError";
	}
}

/** The feature is off, or was never connected. Distinct from a failure: the
 *  UI turns this into "ask an admin to connect OpenRouter", not an error toast. */
export class AssistantNotConfiguredError extends AssistantError {
	constructor() {
		super("The assistant is not connected for this organization");
		this.name = "AssistantNotConfiguredError";
	}
}

/** The operator has switched the feature off for this deployment
 *  (`ASSISTANT_ENABLED=false`). Deliberately a different error from
 *  "not connected": nobody in the org can act on this one, so the UI must not
 *  offer them a settings screen as the fix. */
export class AssistantDisabledError extends AssistantError {
	constructor() {
		super("The assistant is switched off on this deployment");
		this.name = "AssistantDisabledError";
	}
}

// ── the substitutable model port ─────────────────────────────────────────────
//
// Same seam and same justification as `ports.ts`: the agent loop is the densest
// logic here (tool dispatch, the approval suspend/resume, history assembly) and
// none of it can be exercised at all against the real OpenRouter — every test
// would be nondeterministic, billed, and slow. Two adapters justify the
// indirection: the real client in production, a scripted one in tests.

export type ChatModelPort = {
	streamChatCompletion: typeof streamChatCompletion;
	listModels: typeof listOpenRouterModels;
	verifyKey: typeof verifyKey;
};

const realPort: ChatModelPort = {
	streamChatCompletion,
	listModels: listOpenRouterModels,
	verifyKey,
};

let portOverride: ChatModelPort | null = null;

export const chatModel = (): ChatModelPort => portOverride ?? realPort;

/** Test-only: substitute a scripted model. Pass null to restore. */
export const setChatModelForTests = (port: ChatModelPort | null): void => {
	portOverride = port;
};

// ── events ───────────────────────────────────────────────────────────────────

export type AssistantEvent =
	| { type: "message"; messageId: string; role: "user" }
	| { type: "delta"; text: string }
	| { type: "tool_start"; toolCallId: string; name: string }
	| { type: "tool_result"; toolCallId: string; name: string; ok: boolean }
	| {
			type: "approval_required";
			messageId: string;
			toolCallId: string;
			name: string;
			summary: string;
			arguments: string;
			/** A batch write's rows, ticked individually on the card. Null for the
			 *  single-action approvals, which are one yes-or-no. */
			preview: ApprovalPreview | null;
			/** Whether unticking a row means anything — a preview whose tool has no
			 *  `withSelection` is a list to read, not a list to edit. */
			selectable: boolean;
	  }
	| { type: "title"; title: string }
	| { type: "done" }
	| { type: "error"; message: string };

/** How many model round-trips one turn may take before we stop.
 *
 *  A ceiling, not a budget: every step past the first is the model reacting to
 *  a tool result, and a model that has not answered after eight of those is
 *  looping, not working. Without it a malformed tool result the model keeps
 *  retrying is an unbounded spend against the org's key. */
const MAX_STEPS = 8;

/** Tool output that goes back to the model, capped.
 *
 *  `list_time_entries` over 62 days is legitimately hundreds of rows, and the
 *  whole array comes back as one string in the next prompt — so an uncapped
 *  result is both the token bill and, past the context window, a hard failure
 *  mid-conversation. Truncating tells the model to narrow the range instead. */
const MAX_TOOL_RESULT_CHARS = 12_000;

// ── settings ─────────────────────────────────────────────────────────────────

const loadSettings = async (ctx: Ctx) =>
	db.query.assistantSettings.findFirst({
		where: eq(assistantSettings.organizationId, ctx.organizationId),
	});

/** The key plus every assertion that it may be used. Everything that talks to
 *  OpenRouter goes through here, so neither switch can be forgotten at one call
 *  site — which is the failure mode of a boolean checked by convention.
 *
 *  The deployment flag is checked FIRST and before touching the database: when
 *  the operator has turned the feature off, "is it configured for this org" is
 *  not a question worth asking, and a kill switch that still ran a query per
 *  request would not be much of one. */
const requireKey = async (ctx: Ctx) => {
	if (!isAssistantEnabled()) throw new AssistantDisabledError();
	const row = await loadSettings(ctx);
	if (!row || !row.enabled) throw new AssistantNotConfiguredError();
	return row;
};

/** How much of the key an admin ever sees again: `sk-or-v1-` plus six.
 *
 *  The constant prefix is nine characters and identical on every OpenRouter key
 *  in existence, so a plain six-character reveal would be `sk-or-` for
 *  everybody and distinguish nothing. Six *varying* characters is enough to
 *  tell "the key I just rotated to" from "the one that was there before", which
 *  is the only question this string has to answer. */
const KEY_VISIBLE_CHARS = 15;

/**
 * `sk-or-v1-a1b2c3••••••••`.
 *
 * Leading characters only. Deliberately NOT the card-statement convention of
 * showing the last four: the tail is the part nobody can guess, so it is
 * exactly the part worth withholding — and a key is not a card number, where
 * the last four are printed on the thing itself and the customer is expected to
 * match them.
 *
 * The trailing run is a fixed width rather than the key's real length, so the
 * hint doesn't quietly state how long the secret is either.
 */
const maskKey = (key: string) =>
	`${key.slice(0, Math.min(KEY_VISIBLE_CHARS, key.length))}${"•".repeat(8)}`;

/** What an admin is shown about the connection. A missing row is "never
 *  connected" rather than an error, so every field is nullable and one shape
 *  answers both cases. The key itself is never here — only a hint. */
export type AssistantSettingsView = {
	configured: boolean;
	enabled: boolean;
	defaultModel: string | null;
	keyHint: string | null;
	systemPrompt: string | null;
	connectedAt: Date | null;
};

const settings = {
	/** Never returns the key — see the note on the table. Readable by any member
	 *  because the chat page needs to know whether to render itself; only the
	 *  writes below are admin-gated. */
	get: async (ctx: Ctx): Promise<AssistantSettingsView> => {
		const row = await loadSettings(ctx);
		if (!row) {
			return {
				configured: false,
				enabled: false,
				defaultModel: null,
				keyHint: null,
				systemPrompt: null,
				connectedAt: null,
			};
		}
		return {
			configured: true,
			enabled: row.enabled,
			defaultModel: row.defaultModel,
			keyHint: maskKey(row.apiKey),
			// Not a secret, unlike the key beside it: it is house rules an admin
			// wrote, and the settings screen has to render them back to be editable.
			systemPrompt: row.systemPrompt,
			connectedAt: row.createdAt,
		};
	},

	set: async (ctx: Ctx, input: SetAssistantSettingsInput) => {
		await requireAdmin(ctx);
		// Refused rather than stored when the deployment flag is off: an admin
		// pasting a key into a switched-off feature and being told "connected"
		// would be told something untrue about what happens next.
		if (!isAssistantEnabled()) throw new AssistantDisabledError();
		// Verified before it is stored, so a typo fails on the settings screen
		// where there is somewhere to put the error, rather than on somebody
		// else's first question.
		await chatModel().verifyKey(input.apiKey);

		const existing = await loadSettings(ctx);
		if (existing) {
			await db
				.update(assistantSettings)
				.set({
					apiKey: input.apiKey,
					defaultModel: input.defaultModel,
					enabled: true,
					connectedByUserId: ctx.userId,
					updatedAt: new Date(),
				})
				.where(eq(assistantSettings.id, existing.id));
			return { configured: true };
		}
		await db.insert(assistantSettings).values({
			organizationId: ctx.organizationId,
			apiKey: input.apiKey,
			defaultModel: input.defaultModel,
			connectedByUserId: ctx.userId,
		});
		return { configured: true };
	},

	update: async (ctx: Ctx, input: UpdateAssistantSettingsInput) => {
		await requireAdmin(ctx);
		if (!isAssistantEnabled()) throw new AssistantDisabledError();
		const existing = await loadSettings(ctx);
		if (!existing) throw new AssistantNotConfiguredError();
		const patch: Partial<typeof assistantSettings.$inferInsert> = {
			updatedAt: new Date(),
		};
		if (input.defaultModel) patch.defaultModel = input.defaultModel;
		if (input.enabled !== undefined) patch.enabled = input.enabled;
		// `undefined` leaves the rules alone; an explicit null clears them.
		if (input.systemPrompt !== undefined) {
			patch.systemPrompt = input.systemPrompt || null;
		}

		await db
			.update(assistantSettings)
			.set(patch)
			.where(eq(assistantSettings.id, existing.id));
		return { ok: true };
	},

	/** Forgets the credential. Conversations survive on purpose — they are the
	 *  user's own history, and disconnecting a billing account is not a request
	 *  to delete everyone's notes.
	 *
	 *  Deliberately NOT gated on the deployment flag, unlike its neighbours: the
	 *  likely sequence is the operator switching the feature off because
	 *  something went wrong and an admin then wanting the key out of the
	 *  database. Refusing that would leave a stored credential nobody can
	 *  revoke from inside the app. */
	disconnect: async (ctx: Ctx) => {
		await requireAdmin(ctx);
		await db
			.delete(assistantSettings)
			.where(eq(assistantSettings.organizationId, ctx.organizationId));
		return { ok: true };
	},

	/** The catalogue for the model picker. Admin-gated because it is the one
	 *  call that needs the key without a conversation behind it. */
	listModels: async (ctx: Ctx): Promise<OpenRouterModel[]> => {
		await requireAdmin(ctx);
		// A switched-off feature makes no outbound calls, catalogue included.
		if (!isAssistantEnabled()) throw new AssistantDisabledError();
		const row = await loadSettings(ctx);
		if (!row) throw new AssistantNotConfiguredError();
		return chatModel().listModels(row.apiKey);
	},
};

// ── conversations ────────────────────────────────────────────────────────────

/** A conversation belongs to one person: the predicate names both the org and
 *  the user, so another member's thread is not found rather than refused. */
const conversationWhere = (ctx: Ctx, conversationId: string) =>
	and(
		eq(assistantConversation.id, conversationId),
		eq(assistantConversation.organizationId, ctx.organizationId),
		eq(assistantConversation.userId, ctx.userId),
	);

const requireConversation = async (ctx: Ctx, conversationId: string) => {
	const row = await db.query.assistantConversation.findFirst({
		where: conversationWhere(ctx, conversationId),
	});
	if (!row) throw new AssistantError("Conversation not found");
	return row;
};

const conversations = {
	list: async (ctx: Ctx) =>
		db
			.select({
				id: assistantConversation.id,
				title: assistantConversation.title,
				model: assistantConversation.model,
				updatedAt: assistantConversation.updatedAt,
			})
			.from(assistantConversation)
			.where(
				and(
					eq(assistantConversation.organizationId, ctx.organizationId),
					eq(assistantConversation.userId, ctx.userId),
				),
			)
			.orderBy(desc(assistantConversation.updatedAt))
			.limit(100),

	create: async (ctx: Ctx, input: CreateConversationInput = {}) => {
		const config = await requireKey(ctx);
		const [row] = await db
			.insert(assistantConversation)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				title: input.title ?? "New chat",
				// Pinned now, and only from the org default: changing that default
				// later must not silently re-answer an old thread with a different
				// model, and nobody but an admin gets to choose it in the first place.
				model: config.defaultModel,
			})
			.returning();
		if (!row) throw new AssistantError("Could not start a conversation");
		return row;
	},

	get: async (ctx: Ctx, conversationId: string) => {
		const conversation = await requireConversation(ctx, conversationId);
		const messages = await db.query.assistantMessage.findMany({
			where: eq(assistantMessage.conversationId, conversation.id),
			orderBy: asc(assistantMessage.createdAt),
		});
		return { conversation, messages };
	},

	rename: async (ctx: Ctx, input: RenameConversationInput) => {
		await requireConversation(ctx, input.conversationId);
		await db
			.update(assistantConversation)
			.set({ title: input.title, updatedAt: new Date() })
			.where(conversationWhere(ctx, input.conversationId));
		return { ok: true };
	},

	remove: async (ctx: Ctx, conversationId: string) => {
		await requireConversation(ctx, conversationId);
		// Messages cascade.
		await db
			.delete(assistantConversation)
			.where(conversationWhere(ctx, conversationId));
		return { ok: true };
	},
};

// ── the loop ─────────────────────────────────────────────────────────────────

type StoredMessage = typeof assistantMessage.$inferSelect;

/**
 * The DB history in OpenAI's wire shape.
 *
 * The pairing rule is the thing to preserve: an assistant turn carrying
 * `tool_calls` MUST be followed by one `tool` message per call id, or the next
 * request 400s. That invariant is why a suspended write is resumed by
 * completing its call (approved or rejected — a rejection still writes a tool
 * result saying so) rather than by dropping it.
 */
const toWireMessages = (rows: StoredMessage[]): ChatMessage[] =>
	rows.map((row) => {
		if (row.role === "tool") {
			return {
				role: "tool" as const,
				content: row.content,
				tool_call_id: row.toolCallId ?? "",
			};
		}
		if (row.role === "assistant") {
			const message: ChatMessage = {
				role: "assistant",
				content: row.content,
			};
			// Only when there are calls: an assistant message carrying an EMPTY
			// `tool_calls` array is not the same request as one carrying none, and
			// the API rejects the former.
			if (row.toolCalls?.length) {
				message.tool_calls = row.toolCalls.map((call) => ({
					id: call.id,
					type: "function" as const,
					function: { name: call.name, arguments: call.arguments },
				}));
			}
			return message;
		}
		return { role: "user" as const, content: row.content };
	});

const loadHistory = async (conversationId: string) =>
	db.query.assistantMessage.findMany({
		where: eq(assistantMessage.conversationId, conversationId),
		orderBy: asc(assistantMessage.createdAt),
	});

/** The first tool call in `assistant` with no `tool` result yet. */
const firstUnresolvedCall = (
	assistant: StoredMessage,
	history: StoredMessage[],
): AssistantToolCall | null => {
	const answered = new Set(
		history.filter((row) => row.role === "tool").map((row) => row.toolCallId),
	);
	return (
		(assistant.toolCalls ?? []).find((call) => !answered.has(call.id)) ?? null
	);
};

const insertMessage = async (
	ctx: Ctx,
	conversationId: string,
	values: Partial<typeof assistantMessage.$inferInsert> & {
		role: "user" | "assistant" | "tool";
	},
) => {
	const [row] = await db
		.insert(assistantMessage)
		.values({
			organizationId: ctx.organizationId,
			conversationId,
			content: "",
			...values,
		})
		.returning();
	if (!row) throw new AssistantError("Could not save the message");
	return row;
};

/** Every tool call's arguments, before the tool's own schema narrows them. */
const argumentsPayload = z.record(z.string(), z.json());

const stringifyResult = (value: Serializable | void) => {
	const text = JSON.stringify(value ?? null);
	return text.length > MAX_TOOL_RESULT_CHARS
		? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…truncated. Narrow the date range and ask again.`
		: text;
};

/** Runs one tool and returns what the model should be told, including on
 *  failure — a thrown `AccessError` is information the model can act on
 *  ("you aren't assigned to that project"), not a reason to end the turn. */
const executeTool = async (ctx: Ctx, call: AssistantToolCall) => {
	const tool = findTool(call.name);
	if (!tool) {
		return { ok: false, content: `Unknown tool "${call.name}".` };
	}
	// A tool the caller was never offered. Not a security check — the service
	// behind it would refuse anyway — but the model can name a tool it saw in an
	// earlier turn, and a stored conversation outlives the role its owner held
	// when it started. Saying so beats letting the service answer with whatever
	// error its own assertion happens to use.
	if (tool.available && !tool.available(await ctxAccess(ctx))) {
		return {
			ok: false,
			content: `"${call.name}" is not available to this user.`,
		};
	}
	// Two failures, not one. Text that isn't JSON and JSON that isn't an object
	// are different mistakes, and telling the model which it made is the
	// difference between it correcting the call and it repeating the call.
	let args: JsonRecord;
	try {
		const decoded = call.arguments.trim() ? JSON.parse(call.arguments) : {};
		const parsed = argumentsPayload.safeParse(decoded);
		if (!parsed.success) {
			return { ok: false, content: "The arguments were not a JSON object." };
		}
		args = parsed.data;
	} catch {
		return { ok: false, content: "The arguments were not valid JSON." };
	}
	try {
		return { ok: true, content: stringifyResult(await tool.run(ctx, args)) };
	} catch (error) {
		return {
			ok: false,
			content: `Error: ${error instanceof Error ? error.message : "failed"}`,
		};
	}
};

/** The wording on the approval card.
 *
 *  Async because a summary that names an id nobody can read is not a summary —
 *  `summarize` may look the thing up (see assistant-tools). Every failure path
 *  falls back to the tool's own name rather than throwing: this runs on the way
 *  to ASKING for consent, and a turn that died here would leave a person with a
 *  pending write and no way to answer it. */
const describeCall = async (ctx: Ctx, call: AssistantToolCall) => {
	const tool = findTool(call.name);
	const fallback = call.name.replaceAll("_", " ");
	if (!tool?.summarize) return fallback;
	try {
		return await tool.summarize(ctx, JSON.parse(call.arguments || "{}"));
	} catch {
		return fallback;
	}
};

/** The card's table, for a batch write. Same best-effort contract as
 *  `describeCall`: this runs on the way to asking, so a failure costs the rows
 *  and leaves the summary line, never the ability to answer. */
const previewCall = async (
	ctx: Ctx,
	call: AssistantToolCall,
): Promise<ApprovalPreview | null> => {
	const tool = findTool(call.name);
	if (!tool?.preview) return null;
	try {
		return await tool.preview(ctx, JSON.parse(call.arguments || "{}"));
	} catch {
		return null;
	}
};

/** Whether this call stops the turn: anything destructive, plus any batch write
 *  that describes itself with rows. One dialog for fifteen rows is not the
 *  fifteen dialogs the `write` tier exists to avoid — see `ApprovalPreview`. */
const needsApproval = (name: string) => {
	const tool = findTool(name);
	return tool?.kind === "destructive" || Boolean(tool?.preview);
};

/** Narrows a call to the rows the person ticked. Returns the call unchanged
 *  when there is no selection to apply, and null when the selection is empty —
 *  "none of these" is a refusal, not a write of nothing. */
const applySelection = (
	call: AssistantToolCall,
	selectedRowIds: string[] | undefined,
): AssistantToolCall | null => {
	if (!selectedRowIds) return call;
	if (selectedRowIds.length === 0) return null;
	const tool = findTool(call.name);
	if (!tool?.withSelection) return call;
	try {
		const args = JSON.parse(call.arguments || "{}");
		return {
			...call,
			arguments: JSON.stringify(tool.withSelection(args, selectedRowIds)),
		};
	} catch {
		// Unparseable arguments are the tool's problem to report, not this
		// function's to guess at — run what the model actually sent.
		return call;
	}
};

/** The opening question, trimmed to fit the rail. The placeholder only — see
 *  `generateTitle`. */
const truncatedTitle = (message: string) => {
	const line = message.replace(/\s+/g, " ").trim();
	return line.length <= 60 ? line : `${line.slice(0, 57)}…`;
};

/**
 * A real title for the thread, written by the model.
 *
 * The opening message truncated is a poor label: questions start with the same
 * few words ("how many hours did I…", "can you log…"), so a rail of them is a
 * column of identical prefixes with the distinguishing part cut off. A summary
 * puts the subject first, which is the only thing that makes a list of past
 * chats scannable.
 *
 * Deliberately its own tiny completion with no tools and no history rather than
 * asking the answering model to also produce a title: the answer is streamed
 * token by token to the user, and anything else in that response would have to
 * be either shown to them or parsed back out of what they are already reading.
 *
 * Best-effort by construction. Every failure — a rate limit, a refusal, a model
 * that ignores the instruction and writes a paragraph — returns null and leaves
 * the placeholder standing, because a thread whose label is slightly worse is
 * not worth failing a turn over.
 */
const generateTitle = async (
	apiKey: string,
	model: string,
	message: string,
): Promise<string | null> => {
	try {
		const turn = await chatModel().streamChatCompletion({
			apiKey,
			model,
			messages: [
				{
					role: "system",
					content:
						"Write a 2-5 word title for a conversation that starts with the message below. Name the subject, not the act of asking: 'Acme hours in March', not 'Question about hours'. Reply with the title alone — no quotes, no punctuation at the end, no preamble.",
				},
				// Capped: a title does not get better for having read three pages, and
				// this is billed on every new conversation.
				{ role: "user", content: message.slice(0, 500) },
			],
		});
		const title = turn.content
			.trim()
			.replace(/^["“‘']+|["”’'.]+$/g, "")
			.replace(/\s+/g, " ")
			.trim();
		// A model that ignored the instruction and wrote prose is worse than the
		// placeholder, so it is rejected rather than truncated into nonsense.
		if (!title || title.length > 70) return null;
		return title;
	} catch {
		return null;
	}
};

/**
 * One turn, plus the thread's name.
 *
 * The title is generated AFTER the turn rather than before it, for two reasons.
 * It must not delay the first token of the answer — that pause is the whole
 * felt latency of the feature. And by then the turn has had its say, so a
 * failure to name the thread cannot cost the user their answer.
 */
const run = async (
	ctx: Ctx,
	input: RunAssistantInput,
	onEvent: (event: AssistantEvent) => void,
	signal?: AbortSignal,
): Promise<void> => {
	const conversation = await db.query.assistantConversation.findFirst({
		where: conversationWhere(ctx, input.conversationId),
	});
	// Read BEFORE the turn: `runTurn` writes the placeholder, so asking
	// afterwards would never see "New chat" and no thread would ever be named.
	const needsTitle =
		Boolean(input.message) && conversation?.title === "New chat";

	try {
		await runTurn(ctx, input, onEvent, signal);
	} finally {
		if (needsTitle && conversation && input.message) {
			const settings = await loadSettings(ctx);
			const title = settings
				? await generateTitle(
						settings.apiKey,
						conversation.model,
						input.message,
					)
				: null;
			if (title) {
				await db
					.update(assistantConversation)
					.set({ title, updatedAt: new Date() })
					.where(eq(assistantConversation.id, conversation.id));
				onEvent({ type: "title", title });
			}
		}
	}
};

const runTurn = async (
	ctx: Ctx,
	input: RunAssistantInput,
	onEvent: (event: AssistantEvent) => void,
	signal?: AbortSignal,
): Promise<void> => {
	const config = await requireKey(ctx);
	const conversation = await requireConversation(ctx, input.conversationId);

	if (input.message) {
		const row = await insertMessage(ctx, conversation.id, {
			role: "user",
			content: input.message,
		});
		onEvent({ type: "message", messageId: row.id, role: "user" });

		// A placeholder, so the rail is never blank while the real title is being
		// written. `run` replaces it with a summary once the answer is done.
		// Only ever done while the title is still "New chat", so a rename sticks.
		if (conversation.title === "New chat") {
			const title = truncatedTitle(input.message);
			await db
				.update(assistantConversation)
				.set({ title, updatedAt: new Date() })
				.where(eq(assistantConversation.id, conversation.id));
			onEvent({ type: "title", title });
		}
	}

	if (input.resolve) {
		const history = await loadHistory(conversation.id);
		const pending = history.find(
			(row) =>
				row.pendingApproval &&
				(row.toolCalls ?? []).some(
					(call) => call.id === input.resolve?.toolCallId,
				),
		);
		const call = pending?.toolCalls?.find(
			(candidate) => candidate.id === input.resolve?.toolCallId,
		);
		if (!pending || !call) {
			// Already resolved, or never pending. Not an error worth a red toast:
			// the usual cause is the same card being approved twice (two tabs, or a
			// double click), and the second one has nothing left to do.
			onEvent({ type: "done" });
			return;
		}
		if (firstUnresolvedCall(pending, history)?.id !== call.id) {
			onEvent({ type: "done" });
			return;
		}

		// A batch approved with some rows unticked runs as the narrowed call; one
		// with none ticked is a refusal, whatever the button said.
		const narrowed =
			input.resolve.decision === "approved"
				? applySelection(call, input.resolve.selectedRowIds)
				: null;

		if (narrowed) {
			onEvent({ type: "tool_start", toolCallId: call.id, name: call.name });
			const result = await executeTool(ctx, narrowed);
			await insertMessage(ctx, conversation.id, {
				role: "tool",
				content: result.content,
				toolCallId: call.id,
				toolName: call.name,
			});
			onEvent({
				type: "tool_result",
				toolCallId: call.id,
				name: call.name,
				ok: result.ok,
			});
		} else {
			await insertMessage(ctx, conversation.id, {
				role: "tool",
				content:
					input.resolve.decision === "approved"
						? "The user reviewed the rows and selected none of them. Nothing was written. Do not retry; ask which ones they meant."
						: "The user declined this action. Do not retry it; acknowledge and ask what they would prefer.",
				toolCallId: call.id,
				toolName: call.name,
			});
			onEvent({
				type: "tool_result",
				toolCallId: call.id,
				name: call.name,
				ok: false,
			});
		}

		await db
			.update(assistantMessage)
			.set({ approvalDecision: input.resolve.decision })
			.where(eq(assistantMessage.id, pending.id));

		// Another write in the same turn keeps the message pending; the loop below
		// re-enters, finds it, and asks again.
		const after = await loadHistory(conversation.id);
		const stillPending = Boolean(firstUnresolvedCall(pending, after));
		if (!stillPending) {
			await db
				.update(assistantMessage)
				.set({ pendingApproval: false })
				.where(eq(assistantMessage.id, pending.id));
		}
	}

	const today = dayKeyInTz(new Date(), await ctxTimezone(ctx));
	const system = await systemPrompt(ctx, today, config.systemPrompt);
	// Scoped to the caller: a Member is never shown the close sheet or the admin
	// reports, which are both a per-step token cost and a tool call that could
	// only come back refused. Resolved once here, off the Ctx memo.
	const tools = toolDefinitions(await ctxAccess(ctx));

	for (let step = 0; step < MAX_STEPS; step += 1) {
		const history = await loadHistory(conversation.id);

		// Re-ask rather than re-enter the model: a turn suspended on a write is
		// resumed by the client's next call, not by this loop.
		const suspended = history.find((row) => row.pendingApproval);
		if (suspended) {
			const call = firstUnresolvedCall(suspended, history);
			if (call) {
				onEvent({
					type: "approval_required",
					messageId: suspended.id,
					toolCallId: call.id,
					name: call.name,
					// The stored wording where there is one — a turn that asked for two
					// writes has one row and two summaries, so the second falls through
					// to being described now.
					summary: suspended.approvalSummary ?? (await describeCall(ctx, call)),
					arguments: call.arguments,
					// Same fallback for the rows, and for the same reason. Rebuilt only
					// when this row never stored any (the second write of a two-write
					// turn), because a stored preview is what was consented to.
					preview: suspended.approvalPreview ?? (await previewCall(ctx, call)),
					selectable: Boolean(findTool(call.name)?.withSelection),
				});
				onEvent({ type: "done" });
				return;
			}
			await db
				.update(assistantMessage)
				.set({ pendingApproval: false })
				.where(eq(assistantMessage.id, suspended.id));
		}

		let turn: ChatTurn;
		try {
			turn = await chatModel().streamChatCompletion({
				apiKey: config.apiKey,
				model: conversation.model,
				messages: [
					{ role: "system", content: system },
					...toWireMessages(history),
				],
				tools,
				signal,
				onDelta: (text) => onEvent({ type: "delta", text }),
			});
		} catch (error) {
			if (error instanceof OpenRouterError) {
				onEvent({ type: "error", message: error.message });
				return;
			}
			throw error;
		}

		const assistantRow = await insertMessage(ctx, conversation.id, {
			role: "assistant",
			content: turn.content,
			toolCalls: turn.toolCalls.length ? turn.toolCalls : null,
			model: conversation.model,
			promptTokens: turn.promptTokens,
			completionTokens: turn.completionTokens,
			// Decided below, once we know whether any call needs consent.
			pendingApproval: false,
		});

		// Bump the thread so the rail orders by real activity, not by creation.
		await db
			.update(assistantConversation)
			.set({ updatedAt: new Date() })
			.where(eq(assistantConversation.id, conversation.id));

		if (turn.toolCalls.length === 0) {
			onEvent({ type: "done" });
			return;
		}

		// In order, so a read the model wanted done first still happens first.
		let suspendedOn: AssistantToolCall | null = null;
		for (const call of turn.toolCalls) {
			// Destructive tools stop the turn, and so does a batch write that can
			// show its rows. Single creates and corrections still run inline:
			// asking before each one turns "reconstruct my week from my commits"
			// into fifteen dialogs, which is the interaction this feature exists to
			// replace — whereas the batch that would HAVE been those fifteen writes
			// is one card with fifteen rows. See ToolKind and ApprovalPreview in
			// assistant-tools.ts for where the line sits and why.
			if (needsApproval(call.name)) {
				suspendedOn = call;
				break;
			}
			onEvent({ type: "tool_start", toolCallId: call.id, name: call.name });
			const result = await executeTool(ctx, call);
			await insertMessage(ctx, conversation.id, {
				role: "tool",
				content: result.content,
				toolCallId: call.id,
				toolName: call.name,
			});
			onEvent({
				type: "tool_result",
				toolCallId: call.id,
				name: call.name,
				ok: result.ok,
			});
		}

		if (suspendedOn) {
			const summary = await describeCall(ctx, suspendedOn);
			const preview = await previewCall(ctx, suspendedOn);
			const selectable = Boolean(findTool(suspendedOn.name)?.withSelection);
			await db
				.update(assistantMessage)
				.set({
					pendingApproval: true,
					approvalSummary: summary,
					approvalPreview: preview ? { ...preview, selectable } : null,
				})
				.where(eq(assistantMessage.id, assistantRow.id));
			onEvent({
				type: "approval_required",
				messageId: assistantRow.id,
				toolCallId: suspendedOn.id,
				name: suspendedOn.name,
				summary,
				arguments: suspendedOn.arguments,
				preview,
				selectable,
			});
			onEvent({ type: "done" });
			return;
		}
	}

	// Fell out of the loop still calling tools. Said plainly rather than silently
	// ending, because from the outside the two are indistinguishable.
	onEvent({
		type: "error",
		message:
			"The assistant kept working without reaching an answer. Try asking more specifically.",
	});
};

export const assistantService = { settings, conversations, run };
