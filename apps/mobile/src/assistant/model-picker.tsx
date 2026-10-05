import type { AssistantModel } from "@farmer/api-client";
import { useMemo, useState } from "react";
import { FlatList, Modal, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
	EmptyState,
	ErrorState,
	Field,
	IconButton,
	Skeleton,
	Text,
} from "../ui/components";
import { SettingsChoice } from "../ui/settings-list";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";

/** USD per million prompt tokens, as a short label. */
const priceOf = (model: AssistantModel) =>
	model.promptPrice === null
		? undefined
		: model.promptPrice === 0
			? "Free"
			: `$${model.promptPrice.toFixed(2)} for 1M tokens in`;

/**
 * The list of the provider's models, to choose the workspace default. The
 * assistant calls tools on every turn, so only a model that supports tools
 * is offered.
 */
export function ModelPicker({
	visible,
	models,
	selected,
	onClose,
	onPick,
}: {
	visible: boolean;
	models: {
		data?: AssistantModel[];
		error: Error | null;
		refetch: () => void;
	};
	selected: string | null;
	onClose: () => void;
	onPick: (id: string) => void;
}) {
	const palette = usePalette();
	const insets = useSafeAreaInsets();
	const [search, setSearch] = useState("");
	const usable = useMemo(() => {
		const needle = search.trim().toLowerCase();
		return (models.data ?? []).filter(
			(model) =>
				model.supportsTools &&
				(!needle ||
					model.id.toLowerCase().includes(needle) ||
					model.name.toLowerCase().includes(needle)),
		);
	}, [models.data, search]);

	return (
		<Modal
			visible={visible}
			animationType="slide"
			presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
			onRequestClose={onClose}
		>
			<View
				style={{
					flex: 1,
					backgroundColor: palette.background,
					paddingTop: Platform.OS === "ios" ? SPACE.m : insets.top,
				}}
			>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						paddingHorizontal: SPACE.s,
						gap: SPACE.s,
					}}
				>
					<IconButton icon="close" label="Close" onPress={onClose} />
					<Text variant="titleLarge">Choose a model</Text>
				</View>
				<View style={{ padding: SPACE.l }}>
					<Field
						label="Search"
						value={search}
						onChangeText={setSearch}
						placeholder="claude, gpt, gemini"
						autoCapitalize="none"
						autoCorrect={false}
					/>
				</View>
				{models.error ? (
					<ErrorState error={models.error} onRetry={() => models.refetch()} />
				) : !models.data ? (
					<View style={{ padding: SPACE.l, gap: SPACE.s }}>
						<Skeleton height={56} />
						<Skeleton height={56} />
					</View>
				) : (
					<FlatList
						data={usable}
						keyExtractor={(model) => model.id}
						keyboardShouldPersistTaps="handled"
						contentContainerStyle={{ paddingBottom: insets.bottom }}
						ListEmptyComponent={
							<EmptyState
								icon="search"
								title="No model matches"
								message="Only models that can call tools are in the list."
							/>
						}
						renderItem={({ item }) => (
							<SettingsChoice
								title={item.name}
								subtitle={[item.id, priceOf(item)]
									.filter((part) => part)
									.join(", ")}
								selected={item.id === selected}
								onPress={() => onPick(item.id)}
							/>
						)}
					/>
				)}
			</View>
		</Modal>
	);
}
