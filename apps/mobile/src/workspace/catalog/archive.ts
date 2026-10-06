import { useArchiveClient, useArchiveTask } from "../../api/workspace";
import { confirmAction, confirmDestructive, notifyError } from "../components";

/**
 * Archive and restore of a task, with the questions that the edit sheet
 * and the list ask. The edit sheet and the long-press menu share this.
 */
export function useTaskArchive() {
	const archive = useArchiveTask();
	const confirmArchive = (
		task: { id: string; name: string },
		onDone?: () => void,
	) =>
		confirmDestructive({
			title: `Archive ${task.name}?`,
			message:
				"The task leaves the task list. Its entries keep it. You can restore it later.",
			action: "Archive",
			onConfirm: () =>
				archive.mutate(
					{ id: task.id, archived: true },
					{
						onSuccess: onDone,
						onError: (error) =>
							notifyError("Could not archive the task", error),
					},
				),
		});
	const confirmRestore = (task: { id: string; name: string }) =>
		confirmAction({
			title: `Restore ${task.name}?`,
			message:
				"The task keeps its id, so its entries come back attached to it.",
			action: "Restore",
			onConfirm: () =>
				archive.mutate(
					{ id: task.id, archived: false },
					{
						onError: (error) =>
							notifyError("Could not restore the task", error),
					},
				),
		});
	return { confirmArchive, confirmRestore, pending: archive.isPending };
}

/** Archive and restore of a client. A restore asks nothing, as in the
 *  edit sheet. */
export function useClientArchive() {
	const archive = useArchiveClient();
	const set = (
		id: string,
		archived: boolean,
		onDone: (() => void) | undefined,
	) =>
		archive.mutate(
			{ id, archived },
			{
				onSuccess: onDone,
				onError: (error) =>
					notifyError(
						archived
							? "Could not archive the client"
							: "Could not restore the client",
						error,
					),
			},
		);
	const confirmArchive = (
		client: { id: string; name: string },
		onDone?: () => void,
	) =>
		confirmDestructive({
			title: `Archive ${client.name}?`,
			message:
				"An archived client is hidden from the project lists. You can restore it later. A client with an active project cannot be archived.",
			action: "Archive",
			onConfirm: () => set(client.id, true, onDone),
		});
	const restore = (client: { id: string }, onDone?: () => void) =>
		set(client.id, false, onDone);
	return { confirmArchive, restore, pending: archive.isPending };
}
