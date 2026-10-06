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

/**
 * A page sheet in the iOS style: a "Cancel" text button, a rounded search
 * field with a clear button, and the list under them.
 */
export function PickerScreen<Item>(props: PickerScreenProps<Item>) {
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
