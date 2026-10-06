import type { ReactNode } from "react";

import { useAccess, useAssistantSettings } from "../api/capabilities";
import { EmptyState, ErrorState, Skeleton } from "../ui/components";
import { Inset } from "../ui/screen";

/** True when the assistant can answer: the same checks as
 *  `AssistantGate`. A control that starts a conversation shows only then. */
export function useAssistantReady(): boolean {
	const access = useAccess();
	const settings = useAssistantSettings();
	const data = settings.data;
	return (
		access.fullApi &&
		data !== undefined &&
		data.available &&
		!data.keyUnreadable &&
		data.configured &&
		data.enabled
	);
}

/**
 * Shows the chat only when it can answer. Each state has its own sentence,
 * as on the web: a server without the routes, the assistant switched off on
 * the deployment, a key that does not decrypt, no key, and a pause.
 */
export function AssistantGate({ children }: { children: ReactNode }) {
	const access = useAccess();
	const settings = useAssistantSettings();

	if (access.ready && !access.fullApi) {
		return (
			<EmptyState
				icon="assistant"
				title="The assistant needs a newer server"
				message="Ask the administrator of the server to update Farmer. Until then, use the assistant on the web."
			/>
		);
	}
	if (settings.error) {
		return (
			<ErrorState
				error={settings.error}
				onRetry={() => void settings.refetch()}
			/>
		);
	}
	const data = settings.data;
	if (!data) {
		return (
			<Inset>
				<Skeleton height={72} />
				<Skeleton height={72} />
			</Inset>
		);
	}
	if (!data.available) {
		return (
			<EmptyState
				icon="assistant"
				title="The assistant is off on this server"
				message="The administrator of the server switched it off."
			/>
		);
	}
	if (data.keyUnreadable) {
		return (
			<EmptyState
				icon="assistant"
				title="The assistant needs to be connected again"
				message="The stored OpenRouter key can no longer be read. An admin can paste it again in Assistant settings. Every conversation stays."
			/>
		);
	}
	if (!data.configured) {
		return (
			<EmptyState
				icon="assistant"
				title="The assistant is not connected"
				message="An admin can connect this workspace's OpenRouter account in Assistant settings."
			/>
		);
	}
	if (!data.enabled) {
		return (
			<EmptyState
				icon="assistant"
				title="The assistant is paused"
				message="An admin paused the assistant for this workspace."
			/>
		);
	}
	return children;
}
