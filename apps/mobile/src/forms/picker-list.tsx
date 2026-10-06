import type { ReactElement } from "react";
import { Platform, SectionList, View } from "react-native";

import { SectionHeader, Text } from "../ui/components";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import type { PickerSection } from "./picker-model";

/** What a full-screen selector needs. The chrome is `picker-screen.tsx` on
 *  Android and `picker-screen.ios.tsx` on iOS. The list is the same. */
export type PickerScreenProps<Item> = {
	visible: boolean;
	onClose: () => void;
	/** The name of the field, read out for the search input. */
	label: string;
	placeholder: string;
	search: string;
	onSearch: (search: string) => void;
	sections: PickerSection<Item>[];
	keyExtractor: (item: Item) => string;
	renderItem: (item: Item) => ReactElement;
	/** Shown when no row matches the search, for example "No project matches". */
	emptyTitle: string;
};

/** The virtualized list of a selector. An organization can have hundreds
 *  of projects, so the rows draw only when they come into view. */
export function PickerList<Item>({
	sections,
	keyExtractor,
	renderItem,
	emptyTitle,
	search,
}: Pick<
	PickerScreenProps<Item>,
	"sections" | "keyExtractor" | "renderItem" | "emptyTitle" | "search"
>) {
	const palette = usePalette();
	const empty = sections.length === 0;
	return (
		<SectionList
			sections={sections}
			keyExtractor={keyExtractor}
			renderItem={({ item }) => renderItem(item)}
			renderSectionHeader={({ section }) =>
				section.title ? <SectionHeader>{section.title}</SectionHeader> : null
			}
			stickySectionHeadersEnabled={false}
			keyboardShouldPersistTaps="handled"
			keyboardDismissMode="on-drag"
			automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
			contentContainerStyle={{ paddingBottom: SPACE.xxl, flexGrow: 1 }}
			ListEmptyComponent={
				empty ? (
					<View
						style={{
							flex: 1,
							alignItems: "center",
							justifyContent: "center",
							gap: SPACE.xs,
							padding: SPACE.xl,
						}}
					>
						<Text variant="titleMedium" align="center">
							{emptyTitle}
						</Text>
						{search.trim() ? (
							<Text
								variant="bodyMedium"
								color={palette.onSurfaceVariant}
								align="center"
							>
								{`"${search.trim()}"`}
							</Text>
						) : null}
					</View>
				) : null
			}
		/>
	);
}
