import type { ReactNode } from "react";
import { View } from "react-native";

/** One row of an iOS form group (`form-row.ios.tsx`). Android draws no
 *  rows, so this is a plain row of controls. */
export function FormRow({
	children,
}: {
	children: ReactNode;
	onPress?: () => void;
	accessibilityLabel?: string;
	disabled?: boolean;
	grouped?: boolean;
	selected?: boolean;
	tall?: boolean;
}) {
	return <View style={{ flexDirection: "row" }}>{children}</View>;
}
