import type { ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";

import { Icon } from "../../ui/icon";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";

/**
 * A row that is a check box: the whole row is the target, with the box at
 * its end, as a list of things to tick draws it. A box can be partly
 * checked, for a group with some of its entries selected.
 */
export function CheckRow({
	checked,
	onPress,
	label,
	children,
	indent = 0,
}: {
	checked: boolean | "mixed";
	onPress: () => void;
	/** What a screen reader says for the row. */
	label: string;
	children: ReactNode;
	indent?: number;
}) {
	const palette = usePalette();
	const on = checked !== false;
	return (
		<Pressable
			accessibilityRole="checkbox"
			accessibilityState={{ checked }}
			accessibilityLabel={label}
			onPress={onPress}
			android_ripple={{ color: palette.outlineVariant }}
			style={({ pressed }) => ({
				flex: 1,
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.m,
				minHeight: 56,
				paddingLeft: SPACE.l + indent,
				paddingRight: SPACE.s,
				paddingVertical: SPACE.s,
				opacity: Platform.OS === "ios" && pressed ? 0.6 : 1,
			})}
		>
			<View style={{ flex: 1 }}>{children}</View>
			<View
				style={{
					width: 22,
					height: 22,
					borderRadius: Platform.OS === "ios" ? 11 : 4,
					borderWidth: 2,
					borderColor: on ? palette.primary : palette.outline,
					backgroundColor: on ? palette.primary : undefined,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				{on ? (
					<Icon
						name={checked === "mixed" ? "minus" : "check"}
						size={16}
						color={palette.onPrimary}
					/>
				) : null}
			</View>
		</Pressable>
	);
}
