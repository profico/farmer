import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { useRowPosition } from "../ui/settings-list.shared";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";

/** One row of an iOS form group: 44 points high, a hairline under it
 *  from the start of the text, and a highlight while it is pressed. */
export function FormRow({
	children,
	onPress,
	accessibilityLabel,
	disabled,
	grouped = true,
	tall,
}: {
	children: ReactNode;
	onPress?: () => void;
	accessibilityLabel?: string;
	disabled?: boolean;
	/** False when a control in the row must stay reachable on its own. */
	grouped?: boolean;
	/** The row holds a block of text, so it grows with it. */
	tall?: boolean;
}) {
	const palette = usePalette();
	const { last } = useRowPosition();
	return (
		<Pressable
			accessible={onPress ? true : undefined}
			accessibilityRole={onPress ? "button" : undefined}
			accessibilityLabel={grouped ? accessibilityLabel : undefined}
			accessibilityState={onPress ? { disabled: Boolean(disabled) } : undefined}
			onPress={onPress}
			disabled={!onPress || disabled}
			style={({ pressed }) => ({
				paddingLeft: SPACE.l,
				backgroundColor: pressed ? palette.surfaceContainerHigh : undefined,
			})}
		>
			<View
				style={{
					flexDirection: "row",
					alignItems: tall ? "flex-start" : "center",
					gap: SPACE.s,
					minHeight: 44,
					paddingVertical: tall ? SPACE.m : SPACE.s,
					paddingRight: SPACE.l,
					borderBottomWidth: last ? 0 : 0.5,
					borderBottomColor: palette.outline,
				}}
			>
				{children}
			</View>
		</Pressable>
	);
}
