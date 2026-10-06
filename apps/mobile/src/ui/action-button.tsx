import { Button } from "@expo/ui";

import { ControlHost } from "./host";

export type ActionButtonProps = {
	label: string;
	onPress: () => void;
	/** `tonal` and `elevated` are for Android. iOS draws them as `filled`. */
	variant?: "filled" | "tonal" | "elevated" | "outlined" | "text";
	/** Android: `xs` 32dp, `s` 40dp and `m` 56dp high. iOS has one size. */
	size?: "xs" | "s" | "m";
	disabled?: boolean;
};

/**
 * The platform's own button, through `@expo/ui`. Android draws the Material 3
 * Expressive button instead (`action-button.android.tsx`).
 */
export function ActionButton({
	label,
	onPress,
	variant = "filled",
	disabled,
}: ActionButtonProps) {
	return (
		<ControlHost>
			<Button
				label={label}
				onPress={onPress}
				variant={
					variant === "tonal" || variant === "elevated" ? "filled" : variant
				}
				disabled={disabled}
			/>
		</ControlHost>
	);
}
