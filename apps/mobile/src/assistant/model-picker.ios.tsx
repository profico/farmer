import { useState } from "react";
import { FlatList, Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
	ActionButton,
	EmptyState,
	ErrorState,
	Skeleton,
	Text,
} from "../ui/components";
import { useMotionPreference } from "../ui/motion";
import { SearchField } from "../ui/search-field";
import { SettingsChoice } from "../ui/settings-list";
import { RowPosition } from "../ui/settings-list.shared";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import {
	type ModelPickerProps,
	priceOf,
	useUsableModels,
} from "./model-picker-shared";

/**
 * The list of the provider's models, in a sheet. The bar has Cancel at the
 * start and the title in the middle, as the sheets of the forms have. The
 * models are one inset grouped list under a search field. Android draws a
 * full-screen dialog (`model-picker.tsx`).
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
			presentationStyle="pageSheet"
			onRequestClose={onClose}
		>
			<View style={{ flex: 1, backgroundColor: palette.background }}>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "center",
						minHeight: 56,
						paddingHorizontal: SPACE.s,
					}}
				>
					<View style={{ position: "absolute", left: SPACE.s }}>
						<ActionButton label="Cancel" variant="text" onPress={onClose} />
					</View>
					<Text variant="titleMedium">Choose a model</Text>
				</View>
				<SearchField
					value={search}
					onChangeText={setSearch}
					placeholder="claude, gpt, gemini"
				/>
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
						contentContainerStyle={{
							paddingTop: SPACE.m,
							paddingBottom: insets.bottom + SPACE.l,
						}}
						ListEmptyComponent={
							<EmptyState
								icon="search"
								title="No model matches"
								message="Only models that can call tools are in the list."
							/>
						}
						renderItem={({ item, index }) => {
							const first = index === 0;
							const last = index === usable.length - 1;
							return (
								<RowPosition value={{ last, index, count: usable.length }}>
									<View
										style={{
											marginHorizontal: SPACE.l,
											overflow: "hidden",
											backgroundColor: palette.surfaceContainer,
											borderTopLeftRadius: first ? 10 : 0,
											borderTopRightRadius: first ? 10 : 0,
											borderBottomLeftRadius: last ? 10 : 0,
											borderBottomRightRadius: last ? 10 : 0,
										}}
									>
										<SettingsChoice
											title={item.name}
											subtitle={[item.id, priceOf(item)]
												.filter((part) => part)
												.join(", ")}
											selected={item.id === selected}
											onPress={() => onPick(item.id)}
										/>
									</View>
								</RowPosition>
							);
						}}
					/>
				)}
			</View>
		</Modal>
	);
}
