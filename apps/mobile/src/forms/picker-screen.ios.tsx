import { use, useEffect, useRef } from "react";
import {
	Modal,
	Pressable,
	Text as RNText,
	TextInput,
	View,
} from "react-native";

import { CORNER } from "../ui/corner";
import { Icon } from "../ui/icon";
import { useMotionPreference } from "../ui/motion";
import { usePalette } from "../ui/theme";
import { SPACE, TYPE } from "../ui/type";
import { PickerList, type PickerScreenProps } from "./picker-list";
import { type SheetPage, SheetPageContext } from "./sheet-page";

/**
 * A selector. Inside a sheet it is a page that the sheet pushes, with the
 * bar of the sheet (see `SheetPicker`). Elsewhere it is a page sheet of
 * its own (see `ModalPicker`).
 */
export function PickerScreen<Item>(props: PickerScreenProps<Item>) {
	const showPage = use(SheetPageContext);
	return showPage ? (
		<SheetPicker {...props} showPage={showPage} />
	) : (
		<ModalPicker {...props} />
	);
}

/** The page of a selector in the sheet that holds the field. The sheet
 *  draws the back button, the title and the search field in its bar, and
 *  the list as the body. */
function SheetPicker<Item>({
	showPage,
	...props
}: PickerScreenProps<Item> & {
	showPage: (page: SheetPage | null) => void;
}) {
	const { visible, onClose, title, placeholder, onSearch } = props;
	// The page shows the list as the person types, so it is set again on
	// each render of the field. The sheet does not render the field again.
	// Only the field that shows a page may clear it: the other field of the
	// form is closed all the while.
	const shown = useRef(false);
	useEffect(() => {
		if (visible) {
			shown.current = true;
			showPage({
				title,
				placeholder,
				onSearch,
				onBack: onClose,
				content: <PickerList {...props} />,
			});
		} else if (shown.current) {
			shown.current = false;
			showPage(null);
		}
	});
	useEffect(
		() => () => {
			if (shown.current) showPage(null);
		},
		[showPage],
	);
	return null;
}

/**
 * A page sheet in the iOS style: a "Cancel" text button, a rounded search
 * field with a clear button, and the list under them.
 */
function ModalPicker<Item>(props: PickerScreenProps<Item>) {
	const { visible, onClose, label, placeholder, search, onSearch } = props;
	const palette = usePalette();
	const { reduceMotion } = useMotionPreference();
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
						gap: SPACE.m,
						padding: SPACE.l,
					}}
				>
					<View
						style={{
							flex: 1,
							flexDirection: "row",
							alignItems: "center",
							gap: SPACE.s,
							height: 36,
							paddingHorizontal: SPACE.s,
							borderRadius: CORNER.medium - 2,
							backgroundColor: palette.surfaceContainerHigh,
						}}
					>
						<Icon name="search" size={18} color={palette.onSurfaceVariant} />
						<TextInput
							autoFocus
							accessibilityLabel={label}
							value={search}
							onChangeText={onSearch}
							placeholder={placeholder}
							placeholderTextColor={palette.onSurfaceVariant}
							selectionColor={palette.primary}
							autoCorrect={false}
							autoCapitalize="none"
							returnKeyType="search"
							clearButtonMode="while-editing"
							style={[
								TYPE.bodyLarge,
								{ flex: 1, color: palette.onSurface, paddingVertical: 0 },
							]}
						/>
					</View>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Cancel"
						onPress={onClose}
						hitSlop={8}
					>
						<RNText style={[TYPE.bodyLarge, { color: palette.primary }]}>
							Cancel
						</RNText>
					</Pressable>
				</View>
				<PickerList {...props} />
			</View>
		</Modal>
	);
}
