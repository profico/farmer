import { Platform, Pressable, TextInput, View } from "react-native";

import { Icon } from "./icon";
import { usePalette } from "./theme";
import { SPACE, TYPE } from "./type";

const IOS = Platform.OS === "ios";

/** A search box above a list. */
export function SearchField({
	value,
	onChangeText,
	placeholder,
}: {
	value: string;
	onChangeText: (value: string) => void;
	placeholder: string;
}) {
	const palette = usePalette();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.s,
				marginHorizontal: SPACE.l,
				paddingHorizontal: SPACE.m,
				minHeight: IOS ? 36 : 56,
				borderRadius: IOS ? 10 : 28,
				backgroundColor: palette.surfaceContainerHigh,
			}}
		>
			<Icon
				name="search"
				size={IOS ? 16 : 24}
				color={palette.onSurfaceVariant}
			/>
			<TextInput
				value={value}
				onChangeText={onChangeText}
				placeholder={placeholder}
				placeholderTextColor={palette.onSurfaceVariant}
				selectionColor={palette.primary}
				cursorColor={palette.primary}
				accessibilityLabel={placeholder}
				autoCorrect={false}
				autoCapitalize="none"
				returnKeyType="search"
				clearButtonMode="while-editing"
				style={[
					TYPE.bodyLarge,
					{ flex: 1, color: palette.onSurface, paddingVertical: SPACE.s },
				]}
			/>
			{!IOS && value !== "" ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Clear the search"
					onPress={() => onChangeText("")}
					// The icon is 20dp: 14dp on each side makes the 48dp target.
					hitSlop={{ top: 14, bottom: 14, left: 14, right: 12 }}
				>
					<Icon name="close" size={20} color={palette.onSurfaceVariant} />
				</Pressable>
			) : null}
		</View>
	);
}
