import { useState } from "react";
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
import { useMotionPreference } from "../ui/motion";
import { SettingsChoice } from "../ui/settings-list";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import {
	type ModelPickerProps,
	priceOf,
	useUsableModels,
} from "./model-picker-shared";

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
}: ModelPickerProps) {
	const palette = usePalette();
	const { reduceMotion } = useMotionPreference();
	const insets = useSafeAreaInsets();
	const [search, setSearch] = useState("");
	const usable = useUsableModels(models.data, search);

	return (
		<Modal
			visible={visible}
			animationType={reduceMotion ? "fade" : "slide"}
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
