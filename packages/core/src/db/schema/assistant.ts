import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

const ts = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" });
const org = () =>
	text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" });
const stamps = {
	createdAt: ts("created_at").notNull().defaultNow(),
	updatedAt: ts("updated_at").notNull().defaultNow(),
};

// One OpenRouter account per org, connected by an admin (PRD-adjacent; same
// shape as `slackInstallation`). The key is the credential every completion is
// billed against: it is written by one admin-gated server function and never
// read back out — `assistantService.settings.get` selects around it and returns
// a masked hint instead, so a compromised client session cannot exfiltrate it.
// It is stored sealed (`lib/secret-box.ts`), so a database dump cannot either.
//
// Per-org rather than an env var because each workspace pays its own way, and
// because a deployment-wide key would make one org's runaway conversation
// everybody's bill.
export const assistantSettings = pgTable(
	"assistant_settings",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		apiKey: text("api_key").notNull(),
		/** The model every new conversation starts on. A conversation pins its own
		 *  copy at creation, so changing this never rewrites past threads. */
		defaultModel: text("default_model").notNull().default("openai/gpt-4o-mini"),
		/** The off switch. Present-but-disabled is a real state: it keeps the key
		 *  (and everyone's history) while taking the feature away. */
		enabled: boolean("enabled").notNull().default(true),
		// House rules an admin adds to the system prompt — "we bill in 30-minute
		// blocks", "always ask which client before creating a project".
		//
		// APPENDED to the built-in prompt, never replacing it: the base prompt is
		// what teaches the model the date, the timezone, the 15-minute granularity
		// and the id-lookup discipline, and an org that overwrote it would get an
		// assistant that quietly files entries against its training cutoff. It is
		// also fenced and marked as lower precedence where it is assembled
		// (`systemPrompt` in assistant-tools.ts), so an instruction that
		// contradicts a safety rule loses.
		//
		// Bounded, because this rides on every turn of every conversation in the
		// org — an unbounded field is an unbounded token bill nobody would connect
		// to the paragraph they pasted months ago.
		systemPrompt: text("system_prompt"),
		connectedByUserId: text("connected_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		...stamps,
	},
	(t) => [unique("assistant_settings_org_unq").on(t.organizationId)],
);

// A conversation belongs to ONE person in ONE org. There is deliberately no
// sharing: the assistant answers through the caller's own Ctx, so two people
// asking the same question can legitimately get different answers, and a shared
// thread would show a Member the PM's view of it.
export const assistantConversation = pgTable(
	"assistant_conversation",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** Derived from the first user message; renameable. */
		title: text("title").notNull().default("New chat"),
		/** Pinned at creation from `assistantSettings.defaultModel`. */
		model: text("model").notNull(),
		...stamps,
	},
	(t) => [
		index("assistant_conversation_org_user_idx").on(
			t.organizationId,
			t.userId,
			t.updatedAt,
		),
	],
);

/** An OpenAI-shaped tool call, as the model emitted it. */
export type AssistantToolCall = {
	id: string;
	name: string;
	/** Raw JSON string, exactly as streamed — parsed at execution, not here, so
	 *  a malformed call is a tool error the model can see and retry rather than
	 *  a write that fails at the database. */
	arguments: string;
};

export const assistantMessage = pgTable(
	"assistant_message",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => assistantConversation.id, { onDelete: "cascade" }),
		role: text("role").notNull().$type<"user" | "assistant" | "tool">(),
		content: text("content").notNull().default(""),
		/** Set on an assistant turn that asked for tools. */
		toolCalls: jsonb("tool_calls").$type<AssistantToolCall[]>(),
		/** Set on a `tool` row: which call this is the result of. */
		toolCallId: text("tool_call_id"),
		toolName: text("tool_name"),
		// The human-in-the-loop gate, and the reason it lives on the ROW rather
		// than in the stream. A write tool suspends the loop here; approving is a
		// second `run` call that resolves this row. Because the pending state is
		// persisted, closing the tab mid-approval leaves a card that still works
		// on reload — the alternative (holding it on the open SSE connection) loses
		// the pending write to any network blip.
		pendingApproval: boolean("pending_approval").notNull().default(false),
		/** Set once resolved: "approved" | "rejected". Null while pending. */
		approvalDecision: text("approval_decision"),
		// The human sentence the approval card shows, stored rather than recomputed.
		//
		// Two reasons, and the second is the important one. It cannot be rebuilt in
		// the browser at all — the summaries come from `assistant-tools.ts`, which
		// imports the services barrel and so may never reach the client bundle. And
		// it SHOULD not be: this is the wording the person actually consented to,
		// so it belongs to the record of the decision, not to whatever the current
		// code would phrase it as.
		approvalSummary: text("approval_summary"),
		// The rows the approval card showed, for a batch write — same argument as
		// `approvalSummary` one line up, and one step stronger. It cannot be
		// rebuilt in the browser (the previews are assembled in
		// `assistant-tools.ts`, which may never reach the client bundle), it could
		// not be rebuilt HERE either without re-reading entries that the approved
		// write has since changed, and it is the list somebody ticked boxes on. A
		// record of a decision that shows today's data is a record of nothing.
		approvalPreview: jsonb("approval_preview").$type<{
			columns: string[];
			rows: { id: string; cells: string[] }[];
			note?: string;
			/** Whether the card offered per-row ticks. A property of the TOOL, kept
			 *  with the rows so a reloaded card behaves the way the one that was
			 *  first rendered did, rather than the way today's code would. */
			selectable?: boolean;
		}>(),
		model: text("model"),
		promptTokens: integer("prompt_tokens"),
		completionTokens: integer("completion_tokens"),
		createdAt: ts("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("assistant_message_conversation_idx").on(
			t.conversationId,
			t.createdAt,
		),
	],
);

export const assistantConversationRelations = relations(
	assistantConversation,
	({ many }) => ({ messages: many(assistantMessage) }),
);

export const assistantMessageRelations = relations(
	assistantMessage,
	({ one }) => ({
		conversation: one(assistantConversation, {
			fields: [assistantMessage.conversationId],
			references: [assistantConversation.id],
		}),
	}),
);
