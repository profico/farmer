import { SectionList, View } from "react-native";

import { Text } from "../ui/components";
import { RowPosition } from "../ui/settings-list.shared";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import { GroupCaption } from "./form-group";
import type { PickerScreenProps } from "./picker-list";

const RADIUS = 10;

/** The selector as inset grouped sections. The rows draw only when they
 *  come into view, as an organization can have hundreds of projects. The
 *  list scrolls under the bar of the sheet, which the system blurs. */
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
			renderItem={({ item, index, section }) => {
				const first = index === 0;
				const last = index === section.data.length - 1;
				return (
					<RowPosition value={{ last, index, count: section.data.length }}>
						<View
							style={{
								marginHorizontal: SPACE.l,
								overflow: "hidden",
								backgroundColor: palette.surfaceContainer,
								borderTopLeftRadius: first ? RADIUS : 0,
								borderTopRightRadius: first ? RADIUS : 0,
								borderBottomLeftRadius: last ? RADIUS : 0,
								borderBottomRightRadius: last ? RADIUS : 0,
							}}
						>
							{renderItem(item)}
						</View>
					</RowPosition>
				);
			}}
			renderSectionHeader={({ section }) =>
				section.title ? (
					<View style={{ paddingTop: SPACE.l, paddingBottom: 6 }}>
						<View style={{ paddingHorizontal: SPACE.l }}>
							<GroupCaption>{section.title.toUpperCase()}</GroupCaption>
						</View>
					</View>
				) : (
					<View style={{ height: SPACE.s }} />
				)
			}
			stickySectionHeadersEnabled={false}
			contentInsetAdjustmentBehavior="automatic"
			keyboardShouldPersistTaps="handled"
			keyboardDismissMode="on-drag"
			automaticallyAdjustKeyboardInsets
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
