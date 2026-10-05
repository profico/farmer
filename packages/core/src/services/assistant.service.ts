import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PgInsertValue } from "drizzle-orm/pg-core";
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
	type ChatTool,
	type ChatTurn,
	listModels as listOpenRouterModels,
	OpenRouterError,
	type OpenRouterModel,
	OpenRouterStreamCutError,
	streamChatCompletion,
	verifyKey,
} from "../lib/openrouter-client";
import { openAndHeal, sealSecret } from "../lib/secret-box";
import { dayKeyInTz } from "../lib/time";
import { UserFacingError } from "../lib/user-facing-error";
import type {
	CreateConversationInput,
	RenameConversationInput,
	RunAssistantInput,
	SetAssistantSettingsInput,
	UpdateAssistantSettingsInput,
} from "../schema";
import { reportGeneration, reportSpan } from "./ai-telemetry";
import {
	type ApprovalPreview,
	findTool,
	systemPrompt,
	toolDefinitions,
} from "./assistant-tools";
import { diffFields, recordAudit } from "./audit";
import { ctxAccess, ctxTimezone, requireAdmin } from "./context";
import { safeErrorMessage } from "./error-message";
import type { Ctx } from "./types";

export class AssistantError extends UserFacingError {
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

/**
 * The text a person may read for an error that ended a turn, or null when the
 * error is not theirs to read.
 *
 * Only the errors this layer and the services throw ON PURPOSE qualify: a
 * `UserFacingError` (the assistant's own — not connected, switched off,
 * conversation not found — an `AccessError` refusal, a full day), and
 * OpenRouter's account-level answers (no credit, a revoked key). Everything
 * else — a database error, a bug, a failed import — can carry SQL, a hostname
 * or a file path, and belongs in the server log rather than in somebody's
 * chat. The stream route streamed every message through before this existed.
 */
export const userFacingAssistantError = (error: Error): string | null =>
	error instanceof UserFacingError || error instanceof OpenRouterError
		? error.message
		: null;

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
	| {
			type: "tool_start";
			toolCallId: string;
			name: string;
			/** The call's raw arguments, so the trace can name the SUBJECT of the
			 *  step and not only the step: "Read time entries · 1–16 Sep", not a
			 *  column of identical "Read time entries". Read by the client, which
			 *  owns the wording — see `toolDetail` in components/assistant. */
			arguments: string;
	  }
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
 *  retrying is an unbounded spend against the org's key.
 *
 *  The number is told to the model (`systemPrompt`), which is what keeps most
 *  turns from reaching it, and reaching it is answered rather than reported —
 *  see `OUT_OF_STEPS`. */
export const MAX_STEPS = 8;

/** The last thing said to a model that has used every step.
 *
 *  Sent with the tools taken away, so the ceiling is enforced by making another
 *  call impossible rather than by asking the model to stop. A `user` line and
 *  not a second system one: appended after the whole thread, a system message
 *  reads to some models as a new brief and to others as a leaked prompt, while
 *  this is plainly the last thing said in the conversation. */
const OUT_OF_STEPS =
	"Stop using tools and answer now with what you already have. Name the part of the question you could not reach, and offer a narrower question that would get there. Keep to the formatting rules.";

/** What the person is told when even that closing answer does not arrive. */
const NO_ANSWER =
	"The assistant kept working without reaching an answer. Everything it read is still in this thread — ask again more specifically and it will carry on from here.";

/** What the person is told when the provider closes a stream part-way.
 *
 *  The log and the telemetry keep the technical string. This line says what
 *  the person can do: nothing is lost, and a second try is safe. */
const STREAM_CUT =
	"The connection to the model was closed before the answer was complete. Nothing was lost from this thread - ask again in a moment.";

/** What the person is told when the app's own deadline cut the call.
 *
 *  A retry of the same prompt is likely to time out again and bill again, so
 *  this line does not say "try again". It asks for a narrower question. */
const TIMED_OUT =
	"The model took too long to answer. Nothing was lost from this thread - try a narrower question.";

/** Tool output that goes back to the model, capped.
 *
 *  `list_time_entries` over 62 days is legitimately hundreds of rows, and the
 *  whole array comes back as one string in the next prompt — so an uncapped
 *  result is both the token bill and, past the context window, a hard failure
 *  mid-conversation. */
const MAX_TOOL_RESULT_CHARS = 12_000;

// ── settings ─────────────────────────────────────────────────────────────────

/** The row as stored — the key still sealed. For the writes, which only need
 *  to know whether a row exists. */
const readSettingsRow = async (ctx: Ctx) =>
	db.query.assistantSettings.findFirst({
		where: eq(assistantSettings.organizationId, ctx.organizationId),
	});

/** The row with its key opened (`lib/secret-box.ts`). `apiKey` is null when the
 *  stored key does not decrypt — a changed BETTER_AUTH_SECRET — which every
 *  caller treats as "not configured", so reconnecting fixes it. A key stored
 *  before encryption existed is resealed here, on its first read. */
const loadSettings = async (ctx: Ctx) => {
	const row = await readSettingsRow(ctx);
	if (!row) return undefined;
	const apiKey = await openAndHeal(
		row.apiKey,
		async (sealed) => {
			await db
				.update(assistantSettings)
				.set({ apiKey: sealed })
				.where(
					and(
						eq(assistantSettings.id, row.id),
						eq(assistantSettings.apiKey, row.apiKey),
					),
				);
		},
		"the assistant API key",
	);
	return { ...row, apiKey };
};

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
	if (!row || !row.enabled || row.apiKey === null) {
		throw new AssistantNotConfiguredError();
	}
	return { ...row, apiKey: row.apiKey };
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
	/** A usable key is stored: the row exists AND its key opens. What every
	 *  "is the assistant ready" check reads. */
	configured: boolean;
	/** The row exists but its key does not decrypt — `BETTER_AUTH_SECRET`
	 *  changed since it was saved. Not the same as never connected: the admin
	 *  has to be told WHY it stopped, and that pasting the key again is the fix.
	 *  `configured` is false whenever this is true. */
	keyUnreadable: boolean;
	enabled: boolean;
	defaultModel: string | null;
	keyHint: string | null;
	systemPrompt: string | null;
	connectedAt: Date | null;
};

const ASSISTANT_SETTINGS_TARGET = (ctx: Ctx) => ({
	type: "assistant_settings",
	id: ctx.organizationId,
	label: "Assistant settings",
});

const settings = {
	/** Never returns the key — see the note on the table. Readable by any member
	 *  because the chat page needs to know whether to render itself; only the
	 *  writes below are admin-gated. */
	get: async (ctx: Ctx): Promise<AssistantSettingsView> => {
		const row = await loadSettings(ctx);
		if (!row) {
			return {
				configured: false,
				keyUnreadable: false,
				enabled: false,
				defaultModel: null,
				keyHint: null,
				systemPrompt: null,
				connectedAt: null,
			};
		}
		// Every message would throw `AssistantNotConfiguredError` on a key that
		// does not open, so this must not answer `configured` for it — the
		// assistant page and the nav read `configured` as "ready".
		return {
			configured: row.apiKey !== null,
			keyUnreadable: row.apiKey === null,
			enabled: row.enabled,
			defaultModel: row.defaultModel,
			keyHint: row.apiKey === null ? null : maskKey(row.apiKey),
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

		// Sealed at rest (`lib/secret-box.ts`); only `loadSettings` opens it.
		const apiKey = sealSecret(input.apiKey);
		const existing = await readSettingsRow(ctx);
		if (existing) {
			await db
				.update(assistantSettings)
				.set({
					apiKey,
					defaultModel: input.defaultModel,
					enabled: true,
					connectedByUserId: ctx.userId,
					updatedAt: new Date(),
				})
				.where(eq(assistantSettings.id, existing.id));
		} else {
			await db.insert(assistantSettings).values({
				organizationId: ctx.organizationId,
				apiKey,
				defaultModel: input.defaultModel,
				connectedByUserId: ctx.userId,
			});
		}
		// `apiKey` is redacted by `diffFields`; a sealed key differs on every
		// seal, so a reconnect always reads as a change, which it is.
		await recordAudit(ctx, {
			kind: "assistant_settings.updated",
			target: ASSISTANT_SETTINGS_TARGET(ctx),
			changes: diffFields(
				existing,
				{ apiKey, defaultModel: input.defaultModel, enabled: true },
				["apiKey", "defaultModel", "enabled"],
			),
		});
		return { configured: true };
	},

	update: async (ctx: Ctx, input: UpdateAssistantSettingsInput) => {
		await requireAdmin(ctx);
		if (!isAssistantEnabled()) throw new AssistantDisabledError();
		const existing = await readSettingsRow(ctx);
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
		const changes = diffFields(existing, { ...existing, ...patch }, [
			"defaultModel",
			"enabled",
			"systemPrompt",
		]);
		if (changes) {
			await recordAudit(ctx, {
				kind: "assistant_settings.updated",
				target: ASSISTANT_SETTINGS_TARGET(ctx),
				changes,
			});
		}
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
		const [removed] = await db
			.delete(assistantSettings)
			.where(eq(assistantSettings.organizationId, ctx.organizationId))
			.returning({ apiKey: assistantSettings.apiKey });
		if (removed) {
			await recordAudit(ctx, {
				kind: "assistant_settings.updated",
				target: ASSISTANT_SETTINGS_TARGET(ctx),
				changes: diffFields(removed, { apiKey: null }, ["apiKey"]),
				details: { disconnected: true },
			});
		}
		return { ok: true };
	},

	/** The catalogue for the model picker. Admin-gated because it is the one
	 *  call that needs the key without a conversation behind it. */
	listModels: async (ctx: Ctx): Promise<OpenRouterModel[]> => {
		await requireAdmin(ctx);
		// A switched-off feature makes no outbound calls, catalogue included.
		if (!isAssistantEnabled()) throw new AssistantDisabledError();
		const row = await loadSettings(ctx);
		if (!row?.apiKey) throw new AssistantNotConfiguredError();
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

/** The database, or a transaction on it — whichever the caller holds. */
type DbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The rows that belong to the assistant turn at `history[index]`: everything
 * after it, up to the next assistant row.
 *
 * Bounded on both sides, and that is the point of it. A provider may reuse a
 * call id across turns ("call_0" on every turn is common), so a tool row from
 * an EARLIER turn answering the same id used to make a fresh call look
 * answered — and an approved delete was skipped without a word. Position in
 * `history` rather than a timestamp comparison, because `history` is already
 * in the database's order and a JS `Date` keeps only milliseconds.
 */
const turnRows = (history: StoredMessage[], index: number) => {
	const rest = history.slice(index + 1);
	const next = rest.findIndex((row) => row.role === "assistant");
	return next === -1 ? rest : rest.slice(0, next);
};

/** What the model is told about a call whose result is not in the thread.
 *  Never stored — it exists only to keep a damaged history sendable. */
const MISSING_RESULT =
	"No result was recorded for this call. Do not assume that it ran.";

/**
 * The DB history in OpenAI's wire shape.
 *
 * The pairing rule is the thing to preserve: an assistant turn carrying
 * `tool_calls` MUST be followed by one `tool` message per call id, or the next
 * request 400s. That invariant is why a suspended write is resumed by
 * completing its call (approved or rejected — a rejection still writes a tool
 * result saying so) rather than by dropping it.
 *
 * So the pairing is BUILT here rather than trusted from the row order. Each
 * tool row is emitted directly after the call it answers, wherever it sits in
 * the table, and a call with no row gets a synthesized one. A message sent
 * while a card was pending used to land between a call and its result —
 * `assistant(tool_calls) → user → tool` — and every later turn in that thread
 * 400ed. `run` no longer writes that shape, but threads that already hold it
 * are in the database, and this is what makes them answerable again. A tool
 * row that answers no call in its turn is dropped: sent on its own, it is the
 * same 400.
 */
const toWireMessages = (rows: StoredMessage[]): ChatMessage[] => {
	const wire: ChatMessage[] = [];
	rows.forEach((row, index) => {
		// Emitted beside its call, below — never where it happens to sit.
		if (row.role === "tool") return;
		if (row.role === "user") {
			wire.push({ role: "user", content: row.content });
			return;
		}
		const message: ChatMessage = { role: "assistant", content: row.content };
		// Only when there are calls: an assistant message carrying an EMPTY
		// `tool_calls` array is not the same request as one carrying none, and
		// the API rejects the former.
		if (!row.toolCalls?.length) {
			wire.push(message);
			return;
		}
		message.tool_calls = row.toolCalls.map((call) => ({
			id: call.id,
			type: "function" as const,
			function: { name: call.name, arguments: call.arguments },
		}));
		wire.push(message);
		const answers = turnRows(rows, index).filter((r) => r.role === "tool");
		for (const call of row.toolCalls) {
			const answer = answers.find((r) => r.toolCallId === call.id);
			wire.push({
				role: "tool",
				content: answer?.content ?? MISSING_RESULT,
				tool_call_id: call.id,
			});
		}
	});
	return wire;
};

const loadHistory = async (conversationId: string, client: DbClient = db) =>
	client.query.assistantMessage.findMany({
		where: eq(assistantMessage.conversationId, conversationId),
		orderBy: asc(assistantMessage.createdAt),
	});

/** The tool calls in `assistant` with no `tool` result in its own turn yet, in
 *  the order the model asked for them. */
const unresolvedCalls = (
	assistant: StoredMessage,
	history: StoredMessage[],
): AssistantToolCall[] => {
	const index = history.findIndex((row) => row.id === assistant.id);
	if (index === -1) return [];
	const answered = new Set(
		turnRows(history, index)
			.filter((row) => row.role === "tool")
			.map((row) => row.toolCallId),
	);
	return (assistant.toolCalls ?? []).filter((call) => !answered.has(call.id));
};

const firstUnresolvedCall = (
	assistant: StoredMessage,
	history: StoredMessage[],
): AssistantToolCall | null => unresolvedCalls(assistant, history)[0] ?? null;

const insertMessage = async (
	ctx: Ctx,
	conversationId: string,
	values: Partial<typeof assistantMessage.$inferInsert> & {
		role: "user" | "assistant" | "tool";
	},
	opts: { client?: DbClient; sequenced?: boolean } = {},
) => {
	const insert: PgInsertValue<typeof assistantMessage> = {
		organizationId: ctx.organizationId,
		conversationId,
		content: "",
		...values,
	};
	// Inside a transaction the column default, `now()`, is the transaction's
	// START — every row it writes shares one timestamp, and the history's order
	// among them is then whatever the planner returns. `clock_timestamp()` keeps
	// rows written together in the order written.
	if (opts.sequenced) insert.createdAt = sql`clock_timestamp()`;
	const [row] = await (opts.client ?? db)
		.insert(assistantMessage)
		.values(insert)
		.returning();
	if (!row) throw new AssistantError("Could not save the message");
	return row;
};

/**
 * Take the right to answer one tool call — or a run of them — by writing their
 * answers.
 *
 * The tool row IS the claim. It is inserted under a row lock on the assistant
 * turn, after re-reading the thread inside that lock, so two answers racing
 * for the same call (two tabs, or a double click faster than the button's own
 * disabled state) serialize here and the second finds the call answered and
 * gets null. The check used to be a read outside any lock, and both requests
 * passed it and both ran the delete.
 *
 * Only the turn's FIRST unanswered calls may be claimed, which is what keeps a
 * turn's calls running in the order the model asked for them. A batch is
 * claimed in ONE transaction for that reason: claiming reads one at a time and
 * then running them together would let a racing tab slip between two of them.
 */
const claimCalls = async (
	ctx: Ctx,
	conversationId: string,
	assistantId: string,
	calls: AssistantToolCall[],
	content: string,
): Promise<{ call: AssistantToolCall; rowId: string }[] | null> =>
	db.transaction(async (tx) => {
		await tx
			.select({ id: assistantMessage.id })
			.from(assistantMessage)
			.where(eq(assistantMessage.id, assistantId))
			.for("update");
		const history = await loadHistory(conversationId, tx);
		const assistant = history.find((row) => row.id === assistantId);
		if (!assistant) return null;
		// The batch must be exactly the LEADING run of what is still unanswered.
		// One call is the old rule ("only the first") spelled for a list; several
		// is a run of reads taken together, and either way a second tab asking for
		// the same ground finds the first of them already answered and gets null.
		const unresolved = unresolvedCalls(assistant, history);
		if (calls.some((call, index) => unresolved[index]?.id !== call.id)) {
			return null;
		}
		const claimed: { call: AssistantToolCall; rowId: string }[] = [];
		// In order, and `sequenced` so `clock_timestamp()` keeps them in it — the
		// wire history pairs by id, but the transcript is read by a person.
		for (const call of calls) {
			const row = await insertMessage(
				ctx,
				conversationId,
				{ role: "tool", content, toolCallId: call.id, toolName: call.name },
				{ client: tx, sequenced: true },
			);
			claimed.push({ call, rowId: row.id });
		}
		return claimed;
	});

/** What a claimed call's row says until the real result replaces it. Worded
 *  to be true if it is never replaced: a process that dies mid-tool leaves a
 *  call that is answered, so the thread is not stuck, with a statement that
 *  nobody knows how it went. */
const RESULT_PENDING =
	"This call was started, but its result was not recorded. Check before assuming whether it happened.";

const DECLINED =
	"The user declined this action. Do not retry it; acknowledge and ask what they would prefer.";

const NONE_SELECTED =
	"The user reviewed the rows and selected none of them. Nothing was written. Do not retry; ask which ones they meant.";

const MOVED_ON =
	"The user sent a new message instead of answering the approval card, so this was not done. Do not retry it unless they ask again.";

const NOT_REACHED =
	"Not run: it was queued behind an action the user did not approve.";

/** Every tool call's arguments, before the tool's own schema narrows them. */
const argumentsPayload = z.record(z.string(), z.json());

/** The note under a result cut at a row boundary. It says how much is missing
 *  and whose problem that is: the old wording ("narrow the date range and ask
 *  again") sent the model back to the PERSON, who then had to re-ask a question
 *  they had already asked because a cap they cannot see was hit. */
const droppedRowsNote = (kept: number, total: number) =>
	`…${total - kept} of ${total} rows were dropped to fit; the first ${kept} are above. Do not ask the user to repeat themselves. Either answer from these and say which part you used, or call the tool again over a narrower range.`;

/** The same, for a result that is not a list and can only be cut mid-text. */
const CUT_SHORT =
	"…cut short to fit. Do not ask the user to repeat themselves: answer from what is above and say so, or call the tool again for a smaller part of it.";

/**
 * A tool's return value as the model will read it, capped — by ROW wherever
 * the value is a list.
 *
 * A character cut lands in the middle of a row, which leaves the model half an
 * object to guess at and an array that no longer parses. Dropping whole rows
 * instead costs the same tokens and keeps every row it does send readable.
 */
const stringifyResult = (value: Serializable | void) => {
	const text = JSON.stringify(value ?? null);
	if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
	if (Array.isArray(value)) {
		const kept: Serializable[] = [];
		// The two brackets. Each row below adds itself plus the comma joining it
		// to the row before, so the running total is the real encoded length.
		let size = 2;
		for (const row of value) {
			const encoded = JSON.stringify(row ?? null).length + 1;
			if (size + encoded > MAX_TOOL_RESULT_CHARS) break;
			size += encoded;
			kept.push(row);
		}
		// A single row bigger than the whole cap keeps nothing, and an empty list
		// under a note about dropped rows tells the model the tool found nothing.
		// The character cut at least hands it the beginning of the one row.
		if (kept.length > 0) {
			return `${JSON.stringify(kept)}\n${droppedRowsNote(kept.length, value.length)}`;
		}
	}
	return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n${CUT_SHORT}`;
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
		// The content goes to the model provider, so only a message written for
		// a person may pass. A database error carries the SQL and its
		// parameters; that stays in the server log.
		const message = error instanceof Error ? safeErrorMessage(error) : null;
		if (message === null) {
			console.error(`[assistant] tool "${call.name}" failed`, error);
		}
		return {
			ok: false,
			content: `Error: ${message ?? "the tool failed on the server."}`,
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

/** Whether this call stops the turn: anything destructive, any batch write that
 *  describes itself with rows, and any write that reaches past one day of the
 *  caller's own timesheet (`AssistantTool.confirm`). One dialog for fifteen
 *  rows is not the fifteen dialogs the `write` tier exists to avoid — see
 *  `ApprovalPreview`. */
const needsApproval = (name: string) => {
	const tool = findTool(name);
	return (
		tool?.kind === "destructive" ||
		tool?.confirm === true ||
		Boolean(tool?.preview)
	);
};

/** The leading calls of `queue` that may run beside each other: reads, minus
 *  the reads that write on the way through (`AssistantTool.serial`). Stops at
 *  the first call that does not qualify, so order is never reshuffled — only
 *  collapsed. */
const concurrentRun = (queue: AssistantToolCall[]): AssistantToolCall[] => {
	const run: AssistantToolCall[] = [];
	for (const call of queue) {
		const tool = findTool(call.name);
		if (!tool || tool.kind !== "read" || tool.serial) break;
		run.push(call);
	}
	return run;
};

/** Narrows a call to what the person agreed to. Returns the call unchanged
 *  when there is no selection to apply, and null when the selection is empty —
 *  "none of these" is a refusal, not a write of nothing.
 *
 *  The card answers with the rows it left ticked, but those are only the rows
 *  it SHOWED (`shown`, the preview stored with the approval). What is dropped
 *  is the shown rows that are not ticked; a row past the preview's cap was
 *  never on the card and so goes through with the approval, as its note says.
 *  Treating the ticked list as the whole batch filed 25 rows of a 40-row one. */
const applySelection = (
	call: AssistantToolCall,
	selectedRowIds: string[] | undefined,
	shown: { rows: { id: string }[] } | null,
): AssistantToolCall | null => {
	if (!selectedRowIds) return call;
	if (selectedRowIds.length === 0) return null;
	const tool = findTool(call.name);
	if (!tool?.withSelection || !shown) return call;
	const ticked = new Set(selectedRowIds);
	const unticked = new Set(
		shown.rows.map((row) => row.id).filter((id) => !ticked.has(id)),
	);
	if (unticked.size === 0) return call;
	try {
		const args = JSON.parse(call.arguments || "{}");
		return {
			...call,
			arguments: JSON.stringify(tool.withSelection(args, unticked)),
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
/** What one turn's model calls and tool runs are reported under.
 *
 *  Carried down the loop rather than rebuilt, because the whole value of a
 *  trace is that every call in one question shares an id. `generationId` is the
 *  last call made, which is the one whose `tool_calls` any span now running
 *  came from. */
type TurnTrace = {
	id: string;
	conversationId: string;
	model: string;
	generationId: string | null;
};

/**
 * One billed model call, timed and reported.
 *
 * Every call goes through here — the steps, the closing out-of-steps call and
 * the thread title — so a turn's cost is the sum of its trace and nothing is
 * missing from it. A failure is reported too: a rate limit that ends a turn is
 * exactly the thing somebody is looking at the dashboard to find, and a trace
 * that simply stops is indistinguishable from one nobody started.
 *
 * Reporting never changes what the caller sees: the turn, or the same throw.
 */
const generate = async (
	ctx: Ctx,
	trace: TurnTrace,
	step: number | null,
	opts: {
		apiKey: string;
		messages: ChatMessage[];
		tools?: ChatTool[];
		signal?: AbortSignal;
		onDelta?: (text: string) => void;
	},
): Promise<ChatTurn> => {
	const spanId = crypto.randomUUID();
	trace.generationId = spanId;
	const startedAt = Date.now();
	const common = {
		organizationId: ctx.organizationId,
		userId: ctx.userId,
		traceId: trace.id,
		spanId,
		conversationId: trace.conversationId,
		model: trace.model,
		step,
		input: opts.messages,
		tools: opts.tools ?? [],
	};
	try {
		const turn = await chatModel().streamChatCompletion({
			apiKey: opts.apiKey,
			model: trace.model,
			messages: opts.messages,
			tools: opts.tools,
			signal: opts.signal,
			onDelta: opts.onDelta,
		});
		reportGeneration({
			...common,
			latencySeconds: (Date.now() - startedAt) / 1000,
			inputTokens: turn.promptTokens,
			outputTokens: turn.completionTokens,
			costUsd: turn.costUsd,
			finishReason: turn.finishReason,
			toolCalls: turn.toolCalls,
			outputText: turn.content,
			error: null,
		});
		return turn;
	} catch (error) {
		// A cut stream still billed for what it sent, so its tokens, cost and
		// text are reported with the error. Any other failure sent nothing.
		const partial =
			error instanceof OpenRouterStreamCutError ? error.partial : null;
		// The person gets a fixed line, so this is the only place that records
		// why the stream was cut. The message holds the provider's own text.
		if (error instanceof OpenRouterStreamCutError)
			console.error(
				`[assistant] stream cut (trace ${common.traceId}, conversation ${common.conversationId}, model ${common.model}, step ${common.step ?? "none"})`,
				error.message,
			);
		reportGeneration({
			...common,
			latencySeconds: (Date.now() - startedAt) / 1000,
			inputTokens: partial?.promptTokens ?? null,
			outputTokens: partial?.completionTokens ?? null,
			costUsd: partial?.costUsd ?? null,
			finishReason: null,
			toolCalls: partial?.toolCalls ?? [],
			outputText: partial?.content ?? "",
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
};

const generateTitle = async (
	ctx: Ctx,
	trace: TurnTrace,
	apiKey: string,
	message: string,
	signal?: AbortSignal,
): Promise<string | null> => {
	try {
		// `step: null` — this is not a step of the answer. It is one more billed
		// call on the same question, which is why it is on the same trace.
		const turn = await generate(ctx, trace, null, {
			apiKey,
			// The turn's own signal: a reader who has left does not need their
			// thread named, and this is billed like any other completion.
			signal,
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
 *
 * And only after a turn that WORKED. It used to run in a `finally`, so a turn
 * that threw, reported an error or was abandoned by its reader still paid for
 * a second completion — on the same key that had perhaps just been refused,
 * for a reader who was perhaps already gone. The placeholder stands until a
 * later turn succeeds, which is when the thread has earned a name.
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

	// A turn reports most failures as an event rather than a throw (the stream
	// has already answered 200), so success is "no error event" as well as "no
	// exception".
	let failed = false;
	await runTurn(
		ctx,
		input,
		(event) => {
			if (event.type === "error") failed = true;
			onEvent(event);
		},
		signal,
	);
	if (failed || signal?.aborted) return;
	if (!needsTitle || !conversation || !input.message) return;

	const settings = await loadSettings(ctx);
	const title = settings?.apiKey
		? await generateTitle(
				ctx,
				{
					// Its own trace. The answer's trace closed when `runTurn`
					// returned, and naming a thread is a call nobody asked for —
					// folding it into the question's cost would misattribute it.
					id: crypto.randomUUID(),
					conversationId: conversation.id,
					model: conversation.model,
					generationId: null,
				},
				settings.apiKey,
				input.message,
				signal,
			)
		: null;
	if (title) {
		await db
			.update(assistantConversation)
			.set({ title, updatedAt: new Date() })
			.where(eq(assistantConversation.id, conversation.id));
		onEvent({ type: "title", title });
	}
};

/**
 * Suspend the turn on `call`: store what the card shows, and show it.
 *
 * The summary and the rows are written for THIS call, every time a call
 * suspends — including the second write of a turn that asked for two. They
 * used to be stored once, for the first, and never replaced, so the second
 * card read out the first call's wording and table, and a batch's ticked ids
 * were matched against the wrong call's rows. There is one summary column per
 * message, so what it holds is always the call now waiting; an answered call's
 * wording lives on in the stream event and the tool row, not here.
 */
const suspendOn = async (
	ctx: Ctx,
	assistantId: string,
	call: AssistantToolCall,
	onEvent: (event: AssistantEvent) => void,
) => {
	const summary = await describeCall(ctx, call);
	const preview = await previewCall(ctx, call);
	const selectable = Boolean(findTool(call.name)?.withSelection);
	await db
		.update(assistantMessage)
		.set({
			pendingApproval: true,
			// "Null while pending" (see the column): a decision recorded for an
			// earlier call in this turn is not an answer to this one.
			approvalDecision: null,
			approvalSummary: summary,
			approvalPreview: preview ? { ...preview, selectable } : null,
		})
		.where(eq(assistantMessage.id, assistantId));
	onEvent({
		type: "approval_required",
		messageId: assistantId,
		toolCallId: call.id,
		name: call.name,
		summary,
		arguments: call.arguments,
		preview,
		selectable,
	});
	onEvent({ type: "done" });
};

/** Run one claimed call and record what it returned. */
const executeClaimed = async (
	ctx: Ctx,
	trace: TurnTrace,
	claimed: { call: AssistantToolCall; rowId: string },
	toRun: AssistantToolCall,
	onEvent: (event: AssistantEvent) => void,
) => {
	const { call, rowId } = claimed;
	// The one place a tool actually runs — the single path, the claimed batch
	// and the resume after an approval all arrive here — so it is the one place
	// a span has to be reported from.
	const startedAt = Date.now();
	const result = await executeTool(ctx, toRun);
	reportSpan({
		organizationId: ctx.organizationId,
		userId: ctx.userId,
		traceId: trace.id,
		spanId: crypto.randomUUID(),
		// The generation whose `tool_calls` asked for this. Null only for a row
		// left behind by a process that died, which has no call to point at.
		parentId: trace.generationId ?? trace.id,
		conversationId: trace.conversationId,
		name: call.name,
		kind: findTool(call.name)?.kind ?? "unknown",
		latencySeconds: (Date.now() - startedAt) / 1000,
		ok: result.ok,
		inputState: toRun.arguments,
		outputState: result.content,
	});
	await db
		.update(assistantMessage)
		.set({ content: result.content })
		.where(eq(assistantMessage.id, rowId));
	onEvent({
		type: "tool_result",
		toolCallId: call.id,
		name: call.name,
		ok: result.ok,
	});
};

/** Claim a call, run it, and record what it returned. False when somebody
 *  else answered the call first. */
const runClaimed = async (
	ctx: Ctx,
	trace: TurnTrace,
	conversationId: string,
	assistantId: string,
	call: AssistantToolCall,
	toRun: AssistantToolCall,
	onEvent: (event: AssistantEvent) => void,
): Promise<boolean> => {
	const claimed = await claimCalls(
		ctx,
		conversationId,
		assistantId,
		[call],
		RESULT_PENDING,
	);
	const first = claimed?.[0];
	if (!first) return false;
	onEvent({
		type: "tool_start",
		toolCallId: call.id,
		name: call.name,
		arguments: call.arguments,
	});
	await executeClaimed(ctx, trace, first, toRun, onEvent);
	return true;
};

/**
 * Claim a run of reads and run them at the same time.
 *
 * A model that asks for four lists in one step is asking four questions that do
 * not depend on each other, and answering them one after the other makes the
 * person wait for the sum of four round trips to the database — or, for
 * `list_commits` and `list_pull_requests`, to GitHub. Waiting is the whole felt
 * cost of this feature, so the reads go out together.
 *
 * Only reads, and only the ones that declare themselves safe to run beside
 * another (`AssistantTool.serial`). Writes stay strictly in order: the model
 * asked for them in an order, and two of them may be about the same day.
 */
const runClaimedBatch = async (
	ctx: Ctx,
	trace: TurnTrace,
	conversationId: string,
	assistantId: string,
	calls: AssistantToolCall[],
	onEvent: (event: AssistantEvent) => void,
): Promise<boolean> => {
	const claimed = await claimCalls(
		ctx,
		conversationId,
		assistantId,
		calls,
		RESULT_PENDING,
	);
	if (!claimed) return false;
	// Every step announced before any of them runs, so the trace shows the four
	// spinners the person is actually waiting on rather than one at a time.
	for (const { call } of claimed) {
		onEvent({
			type: "tool_start",
			toolCallId: call.id,
			name: call.name,
			arguments: call.arguments,
		});
	}
	await Promise.all(
		claimed.map((entry) =>
			executeClaimed(ctx, trace, entry, entry.call, onEvent),
		),
	);
	return true;
};

/**
 * Work through one assistant turn's unanswered calls, in the order the model
 * asked for them, until one needs consent.
 *
 * Shared by a fresh turn and by the resume after an approval, and the sharing
 * is the fix: the resume used to hand every remaining call back to the
 * approval branch, so a read queued behind a delete got a card of its own once
 * the delete was answered. A read is not something anybody consents to.
 *
 * True when the turn is now suspended on a card; false when every call has an
 * answer.
 */
const runPendingCalls = async (
	ctx: Ctx,
	trace: TurnTrace,
	conversationId: string,
	assistant: StoredMessage,
	onEvent: (event: AssistantEvent) => void,
): Promise<boolean> => {
	const history = await loadHistory(conversationId);
	let queue = unresolvedCalls(assistant, history);
	while (queue.length > 0) {
		const head = queue[0];
		if (!head) break;
		// Destructive tools stop the turn, and so does a batch write that can
		// show its rows, and a write marked `confirm` — one that changes the org
		// or somebody's access, or writes many days at once, which text the model
		// read in a tool result must not be able to set off unseen. Single
		// entries still run inline: asking before each one turns "reconstruct my
		// week from my commits" into fifteen dialogs, which is the interaction
		// this feature exists to replace — whereas the batch that would HAVE been
		// those fifteen writes is one card with fifteen rows. See ToolKind,
		// AssistantTool.confirm and ApprovalPreview in assistant-tools.ts for
		// where the line sits and why.
		if (needsApproval(head.name)) {
			await suspendOn(ctx, assistant.id, head, onEvent);
			return true;
		}
		// A leading run of independent reads goes out together; everything else
		// keeps its place in the queue. See `runClaimedBatch`.
		const together = concurrentRun(queue);
		const ran =
			together.length > 1
				? await runClaimedBatch(
						ctx,
						trace,
						conversationId,
						assistant.id,
						together,
						onEvent,
					)
				: await runClaimed(
						ctx,
						trace,
						conversationId,
						assistant.id,
						head,
						head,
						onEvent,
					);
		// Lost the claim: a new message answered this turn's calls while the
		// approved one ran (`abandonPendingCalls`), and cleared the flag itself.
		if (!ran) return false;
		queue = queue.slice(together.length > 1 ? together.length : 1);
	}
	if (assistant.pendingApproval) {
		await db
			.update(assistantMessage)
			.set({ pendingApproval: false })
			.where(eq(assistantMessage.id, assistant.id));
	}
	return false;
};

/**
 * Answer, as declined, every call a suspended turn is still waiting on — so a
 * new message can join the thread after them rather than between a call and
 * its result.
 *
 * A message typed past an approval card is what a person does when they have
 * moved on, so it is read as "no". The alternative readings are both worse:
 * refusing the message leaves them stuck behind a card they chose to ignore,
 * and writing it anyway (what this used to do) put a user row between the
 * card's call and its eventual result, which 400s every later turn.
 *
 * Under the same row lock `claimCall` takes, so an approval racing the
 * message either claims the call first (and this finds it answered) or finds
 * it answered here.
 */
const abandonPendingCalls = async (ctx: Ctx, conversationId: string) =>
	db.transaction(async (tx) => {
		const locked = await tx
			.select({ id: assistantMessage.id })
			.from(assistantMessage)
			.where(
				and(
					eq(assistantMessage.conversationId, conversationId),
					eq(assistantMessage.pendingApproval, true),
				),
			)
			.for("update");
		if (locked.length === 0) return;
		const history = await loadHistory(conversationId, tx);
		for (const { id } of locked) {
			const assistant = history.find((row) => row.id === id);
			if (!assistant) continue;
			const calls = unresolvedCalls(assistant, history);
			for (const [index, call] of calls.entries()) {
				await insertMessage(
					ctx,
					conversationId,
					{
						role: "tool",
						// The first is the one the card asked about; the rest were
						// queued behind it and never reached.
						content: index === 0 ? MOVED_ON : NOT_REACHED,
						toolCallId: call.id,
						toolName: call.name,
					},
					{ client: tx, sequenced: true },
				);
			}
			await tx
				.update(assistantMessage)
				.set({
					pendingApproval: false,
					approvalDecision:
						calls.length > 0 ? "rejected" : assistant.approvalDecision,
				})
				.where(eq(assistantMessage.id, id));
		}
	});

/**
 * Store what a turn wrote before it was stopped or cut, text only.
 *
 * What arrived is kept, because it was paid for and because a half answer
 * beats the question sitting there alone. The HALF-ARRIVED TOOL CALLS ARE
 * DROPPED. A stored `tool_calls` row with no `tool` result under it 400s the
 * next request for the rest of the thread's life, and the calls never ran.
 * An empty partial stores nothing.
 */
const keepPartial = async (
	ctx: Ctx,
	conversation: { id: string; model: string },
	turn: ChatTurn,
): Promise<void> => {
	if (!turn.content.trim()) return;
	await insertMessage(ctx, conversation.id, {
		role: "assistant",
		content: turn.content,
		toolCalls: null,
		model: conversation.model,
		promptTokens: turn.promptTokens,
		completionTokens: turn.completionTokens,
		pendingApproval: false,
	});
	await db
		.update(assistantConversation)
		.set({ updatedAt: new Date() })
		.where(eq(assistantConversation.id, conversation.id));
};

const runTurn = async (
	ctx: Ctx,
	input: RunAssistantInput,
	onEvent: (event: AssistantEvent) => void,
	signal?: AbortSignal,
): Promise<void> => {
	const config = await requireKey(ctx);
	const conversation = await requireConversation(ctx, input.conversationId);
	// One trace for the whole question, so the steps it took and the tools they
	// ran are one thing somebody can read a cost off — see `ai-telemetry.ts`.
	// An approval resume is a second `run` call and therefore a second trace,
	// which is honest: it is a second request, minutes later, that the person
	// consented to separately.
	const trace: TurnTrace = {
		id: crypto.randomUUID(),
		conversationId: conversation.id,
		model: conversation.model,
		// Set by each generation, so the spans its tool calls produce can name
		// the call that asked for them.
		generationId: null,
	};

	if (input.message) {
		// Before the message, never after: see `abandonPendingCalls`.
		await abandonPendingCalls(ctx, conversation.id);
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
		// Already resolved, never pending, or not the call the turn is waiting
		// on. Not an error worth a red toast: the usual cause is the same card
		// being approved twice (two tabs, or a double click), and the second one
		// has nothing left to do. A cheap early exit only — the claim below is
		// what actually makes the second one a no-op when both get this far.
		if (
			!pending ||
			!call ||
			firstUnresolvedCall(pending, history)?.id !== call.id
		) {
			onEvent({ type: "done" });
			return;
		}

		// A batch approved with some rows unticked runs as the narrowed call; one
		// with none ticked is a refusal, whatever the button said.
		const { decision, selectedRowIds } = input.resolve;
		const narrowed =
			decision === "approved"
				? applySelection(call, selectedRowIds, pending.approvalPreview)
				: null;

		const answered = narrowed
			? await runClaimed(
					ctx,
					trace,
					conversation.id,
					pending.id,
					call,
					narrowed,
					onEvent,
				)
			: (await claimCalls(
					ctx,
					conversation.id,
					pending.id,
					[call],
					decision === "approved" ? NONE_SELECTED : DECLINED,
				)) !== null;
		if (!answered) {
			onEvent({ type: "done" });
			return;
		}
		if (!narrowed) {
			onEvent({
				type: "tool_result",
				toolCallId: call.id,
				name: call.name,
				ok: false,
			});
		}

		await db
			.update(assistantMessage)
			.set({ approvalDecision: decision })
			.where(eq(assistantMessage.id, pending.id));

		// The rest of the turn: reads and writes run now, and a second
		// destructive call stops it again with a card of its own.
		if (await runPendingCalls(ctx, trace, conversation.id, pending, onEvent))
			return;
	}

	const today = dayKeyInTz(new Date(), await ctxTimezone(ctx));
	const system = await systemPrompt(ctx, today, config.systemPrompt, MAX_STEPS);
	// Scoped to the caller: a Member is never shown the admin reports, which are both a per-step token cost and a tool call that could
	// only come back refused. Resolved once here, off the Ctx memo.
	const tools = toolDefinitions(await ctxAccess(ctx));

	for (let step = 0; step < MAX_STEPS; step += 1) {
		const history = await loadHistory(conversation.id);

		// Re-ask rather than re-enter the model: a turn suspended on a write is
		// resumed by the client's next call, not by this loop. Neither a new
		// message nor a resolve reaches here with a card still up, so this is the
		// net under everything else — a row left pending by a process that died.
		const suspended = history.find((row) => row.pendingApproval);
		if (suspended) {
			const call = firstUnresolvedCall(suspended, history);
			if (call) {
				onEvent({
					type: "approval_required",
					messageId: suspended.id,
					toolCallId: call.id,
					name: call.name,
					// The stored wording, because it is what was shown — and since
					// `suspendOn` rewrites it for every call that suspends, it is this
					// call's. Rebuilt only for a row that never stored any.
					summary: suspended.approvalSummary ?? (await describeCall(ctx, call)),
					arguments: call.arguments,
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
			turn = await generate(ctx, trace, step + 1, {
				apiKey: config.apiKey,
				messages: [
					{ role: "system", content: system },
					...toWireMessages(history),
				],
				tools,
				signal,
				onDelta: (text) => onEvent({ type: "delta", text }),
			});
		} catch (error) {
			if (error instanceof OpenRouterStreamCutError) {
				// Cut by the provider. What arrived is kept under the same rule as
				// a stop. A person who stopped the turn is told nothing.
				await keepPartial(ctx, conversation, error.partial);
				if (!signal?.aborted)
					onEvent({
						type: "error",
						message: error.timedOut ? TIMED_OUT : STREAM_CUT,
					});
				return;
			}
			if (error instanceof OpenRouterError) {
				onEvent({ type: "error", message: error.message });
				return;
			}
			throw error;
		}

		// Stopped part-way — the person pressed Stop, or closed the tab.
		//
		// What arrived is kept, because it was paid for and because a half
		// answer beats the question sitting there alone; but the HALF-ARRIVED
		// TOOL CALLS ARE DROPPED. A stored `tool_calls` row with no `tool` result
		// under it 400s the next request for the rest of the thread's life, and
		// the calls were never run, so there is nothing to answer them with.
		// An empty partial stores nothing and reports nothing: stopping a turn
		// before it said anything is not a failure to explain.
		if (signal?.aborted) {
			await keepPartial(ctx, conversation, turn);
			return;
		}

		// A turn with neither text nor a tool call is nothing at all, and it used
		// to end the loop as a success. The blank row it stored is one the
		// transcript skips (an assistant row with no text is a pure tool turn,
		// rendered as its trace), so the person was left looking at their own
		// question with no answer under it and no error to explain the gap —
		// which is how a short, vague follow-up ("let me see it") read when a
		// model returned an empty completion. Said plainly instead, in the same
		// words the out-of-steps path uses, because from the outside the two
		// failures are the same failure.
		if (turn.toolCalls.length === 0 && !turn.content.trim()) {
			onEvent({ type: "error", message: NO_ANSWER });
			return;
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
		if (
			await runPendingCalls(ctx, trace, conversation.id, assistantRow, onEvent)
		) {
			return;
		}
	}

	// Fell out of the loop still calling tools.
	//
	// The turn used to end here on a red line, which threw away everything the
	// eight steps had read and told the person their question had failed — when
	// what had really happened is that the answer was most of the way there. So
	// one more call is spent, with the tools taken away: the model cannot ask for
	// a ninth step, so this terminates, and it answers from the tool results
	// already in the thread. Not billed on a turn nobody is waiting for.
	if (signal?.aborted) return;

	let closing: ChatTurn | null = null;
	try {
		closing = await generate(ctx, trace, null, {
			apiKey: config.apiKey,
			messages: [
				{ role: "system", content: system },
				...toWireMessages(await loadHistory(conversation.id)),
				{ role: "user", content: OUT_OF_STEPS },
			],
			signal,
			onDelta: (text) => onEvent({ type: "delta", text }),
		});
	} catch (error) {
		// Anything but OpenRouter's own answer is a bug, and belongs in the log
		// the stream route keeps rather than swallowed here. `NO_ANSWER` covers
		// the rest below.
		if (!(error instanceof OpenRouterError)) throw error;
		if (error instanceof OpenRouterStreamCutError) {
			// A cut closing answer is a failure of its own: the person is told
			// the connection closed, not that the model kept working.
			await keepPartial(ctx, conversation, error.partial);
			if (!signal?.aborted)
				onEvent({
					type: "error",
					message: error.timedOut ? TIMED_OUT : STREAM_CUT,
				});
			return;
		}
	}

	// The nudge itself is deliberately NOT stored: it is this loop talking to the
	// model about its own ceiling, and a later turn re-reading it as something
	// the person said would be a lie about the conversation.
	if (closing?.content.trim()) {
		await insertMessage(ctx, conversation.id, {
			role: "assistant",
			content: closing.content,
			model: conversation.model,
			promptTokens: closing.promptTokens,
			completionTokens: closing.completionTokens,
			pendingApproval: false,
		});
		await db
			.update(assistantConversation)
			.set({ updatedAt: new Date() })
			.where(eq(assistantConversation.id, conversation.id));
		onEvent({ type: "done" });
		return;
	}

	// No closing answer either. Said plainly rather than silently ending, because
	// from the outside the two are indistinguishable.
	onEvent({ type: "error", message: NO_ANSWER });
};

export const assistantService = { settings, conversations, run };
