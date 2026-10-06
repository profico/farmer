import { Alert } from "react-native";

import { useDeleteFilingRule, useDeleteRecurringBlock } from "../api/you";

/**
 * Gives `confirm`, which asks "Delete this recurring block?" and deletes it
 * on a yes, and the state of the delete. The edit sheet and the long-press
 * menu of the list share this, so the question is the same.
 */
export function useConfirmDeleteBlock() {
	const remove = useDeleteRecurringBlock();
	const confirm = (block: { id: string }, onDone?: () => void) =>
		Alert.alert("Delete this recurring block?", "This cannot be undone.", [
			{ text: "Cancel", style: "cancel" },
			{
				text: "Delete",
				style: "destructive",
				onPress: () => remove.mutate(block.id, { onSuccess: onDone }),
			},
		]);
	return { confirm, pending: remove.isPending, error: remove.error };
}

/** The same for a filing rule: "Remove this rule?". */
export function useConfirmRemoveRule() {
	const remove = useDeleteFilingRule();
	const confirm = (rule: { id: string }, onDone?: () => void) =>
		Alert.alert(
			"Remove this rule?",
			"Entries it filed stay where they are. New ones with this name wait for you in File your time again.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Remove",
					style: "destructive",
					onPress: () => remove.mutate(rule.id, { onSuccess: onDone }),
				},
			],
		);
	return { confirm, pending: remove.isPending, error: remove.error };
}
