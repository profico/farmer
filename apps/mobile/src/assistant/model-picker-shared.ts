import type { AssistantModel } from "@farmer/api-client";
import { useMemo } from "react";

/** USD per million prompt tokens, as a short label. */
export const priceOf = (model: AssistantModel) =>
	model.promptPrice === null
		? undefined
		: model.promptPrice === 0
			? "Free"
			: `$${model.promptPrice.toFixed(2)} for 1M tokens in`;

export type ModelPickerProps = {
	visible: boolean;
	models: {
		data?: AssistantModel[];
		error: Error | null;
		refetch: () => void;
	};
	selected: string | null;
	onClose: () => void;
	onPick: (id: string) => void;
};

/** The models that match a search. The assistant calls tools on every turn,
 *  so only a model that supports tools is offered. */
export const useUsableModels = (
	data: AssistantModel[] | undefined,
	search: string,
) =>
	useMemo(() => {
		const needle = search.trim().toLowerCase();
		return (data ?? []).filter(
			(model) =>
				model.supportsTools &&
				(!needle ||
					model.id.toLowerCase().includes(needle) ||
					model.name.toLowerCase().includes(needle)),
		);
	}, [data, search]);
