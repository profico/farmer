import type { WebhookEndpoint } from "@farmer/api-client";

import { useDeleteWebhookEndpoint } from "../../api/workspace";
import { confirmDestructive, notifyError } from "../components";

/**
 * Gives `confirm`, which asks "Delete this endpoint?" and deletes it on a
 * yes, and the state of the delete. The endpoint screen and the long-press
 * menu of the list share this, so the question is the same.
 */
export function useConfirmDeleteEndpoint() {
	const remove = useDeleteWebhookEndpoint();
	const confirm = (
		endpoint: Pick<WebhookEndpoint, "id" | "url">,
		onDeleted?: () => void,
	) =>
		confirmDestructive({
			title: "Delete this endpoint?",
			message: `Farmer stops sending events to ${endpoint.url}. Its delivery log is deleted too.`,
			action: "Delete",
			onConfirm: () =>
				remove.mutate(endpoint.id, {
					onSuccess: onDeleted,
					onError: (error) => notifyError("Could not delete", error),
				}),
		});
	return { confirm, pending: remove.isPending };
}
