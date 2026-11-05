import type { TimeEntry } from "@farmer/api-client";

import { useDeleteTimeEntry } from "../api/time";
import { showDialog } from "../ui/dialog";
import { notifyError } from "../ui/notify-error";
import { removed } from "./haptics";

/**
 * Gives `confirm`, which asks "Delete this entry?" and deletes the entry on
 * a yes, and the state of the delete. The edit sheet
 * and the long-press menu of a row share this, so the question and the
 * firm tap are the same. `onDeleted` runs after the server accepts it.
 */
export function useConfirmDeleteEntry() {
	const remove = useDeleteTimeEntry();
	const confirm = (entry: Pick<TimeEntry, "id">, onDeleted?: () => void) =>
		showDialog("Delete this entry?", "This cannot be undone.", [
			{ text: "Cancel", style: "cancel" },
			{
				text: "Delete",
				style: "destructive",
				onPress: () =>
					remove.mutate(entry.id, {
						onSuccess: () => {
							removed();
							onDeleted?.();
						},
						onError: (error) =>
							notifyError("Could not delete the entry", error),
					}),
			},
		]);
	return { confirm, pending: remove.isPending };
}
