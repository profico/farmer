import { Modal, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { IconButton } from "../ui/components";
import { RADIUS } from "../ui/corner";
import { Icon } from "../ui/icon";
import { useMotionPreference } from "../ui/motion";
import { usePalette } from "../ui/theme";
import { SPACE, TYPE } from "../ui/type";
import { PickerList, type PickerScreenProps } from "./picker-list";

/**
 * The full-screen search view of Material 3: a bar with a back arrow, the
 * search input and a clear button, and the list under it. The input takes
 * the focus when the view opens. The hardware back button closes it.
 */
export function PickerScreen<Item>(props: PickerScreenProps<Item>) {
	const { visible, onClose, label, placeholder, search, onSearch } = props;
	const palette = usePalette();
	const { reduceMotion } = useMotionPreference();
	return (
		<Modal
			visible={visible}
			animationType={reduceMotion ? "fade" : "slide"}
			onRequestClose={onClose}
			statusBarTranslucent
			navigationBarTranslucent
		>
			<SafeAreaView
				style={{ flex: 1, backgroundColor: palette.surface }}
				edges={["top", "bottom", "left", "right"]}
			>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						height: 56,
						marginHorizontal: SPACE.l,
						marginVertical: SPACE.s,
						paddingHorizontal: SPACE.xs,
						gap: SPACE.xs,
						borderRadius: RADIUS.button,
						backgroundColor: palette.surfaceContainerHigh,
					}}
				>
					<IconButton icon="back" label="Close" onPress={onClose} />
					<TextInput
						autoFocus
						accessibilityLabel={label}
						value={search}
						onChangeText={onSearch}
						placeholder={placeholder}
						placeholderTextColor={palette.onSurfaceVariant}
						selectionColor={palette.primary}
						cursorColor={palette.primary}
						autoCorrect={false}
						autoCapitalize="none"
						returnKeyType="search"
						style={[
							TYPE.bodyLarge,
							{ flex: 1, color: palette.onSurface, paddingVertical: 0 },
						]}
					/>
					{search ? (
						<IconButton
							icon="close"
							label="Clear search"
							onPress={() => onSearch("")}
						/>
					) : (
						<View style={{ width: 40, alignItems: "center" }}>
							<Icon name="search" size={24} color={palette.onSurfaceVariant} />
						</View>
					)}
				</View>
				<PickerList {...props} />
			</SafeAreaView>
		</Modal>
	);
}
