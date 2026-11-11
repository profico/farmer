import type { AssistantUsageInput } from "@farmer/core/schema";
import { queryOptions } from "@tanstack/react-query";

import {
	getAssistantSettings,
	getAssistantUsage,
	getConversation,
	getSharedConversation,
	listAssistantModels,
	listConversations,
	searchConversations,
} from "#/server/assistant.ts";

import { queryKeys } from "./keys.ts";

export const assistantSettingsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).assistant, "settings"],
		queryFn: () => getAssistantSettings(),
	});

export const assistantModelsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).assistant, "models"],
		queryFn: () => listAssistantModels(),
		// The catalogue is ~300 models and changes on OpenRouter's schedule, not
		// ours. Refetching it on every focus of the settings screen is a round trip
		// to a third party for an answer that was right a minute ago.
		staleTime: 30 * 60_000,
	});

export const assistantUsageQuery = (org: string, input: AssistantUsageInput) =>
	queryOptions({
		queryKey: [...queryKeys(org).assistant, "usage", input],
		queryFn: () => getAssistantUsage({ data: input }),
	});

export const conversationsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).assistant, "conversations"],
		queryFn: () => listConversations(),
	});

export const conversationQuery = (org: string, conversationId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).assistant, "conversation", conversationId],
		queryFn: () => getConversation({ data: { conversationId } }),
	});

export const searchConversationsQuery = (org: string, q: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).assistant, "search", q],
		queryFn: () => searchConversations({ data: { q } }),
	});

export const sharedConversationQuery = (org: string, conversationId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).assistant, "shared", conversationId],
		queryFn: () => getSharedConversation({ data: { conversationId } }),
		retry: false,
	});
