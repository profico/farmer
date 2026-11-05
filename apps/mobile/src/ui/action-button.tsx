import { Button } from "@expo/ui";
import { Button as SwiftButton, Host, Text } from "@expo/ui/swift-ui";
import * as swiftUi from "@expo/ui/swift-ui/modifiers";

import { ControlHost, useHostTheme } from "./host";

export type ActionButtonProps = {
	label: string;
	onPress: () => void;
	/** `tonal` and `elevated` are for Android. iOS draws them as `filled`. */
	variant?: "filled" | "tonal" | "elevated" | "outlined" | "text";
	/** The text of the label. Android draws it in the error colour, for an
	 *  action that deletes something. iOS has its own button for that
	 *  (`destructive-button.ios.tsx`). */
	tone?: "default" | "error";
	disabled?: boolean;
	/** iOS: the button fills the width, as the main button of a form does.
	 *  Android ignores it. */
	wide?: boolean;
	/** Android: a spinner takes the place of the label, and the button keeps
	 *  its width. iOS ignores it. */
	busy?: boolean;
};

/** The width that a full-width button takes, more than any screen. */
const FULL_WIDTH = 10_000;

const WIDE_STYLE = {
	filled: "borderedProminent",
	tonal: "borderedProminent",
	elevated: "borderedProminent",
	outlined: "bordered",
	text: "borderless",
} as const;

/** The full-width button of iOS 26: a capsule in the large size, filled for
 *  the main action and tinted for the others. */
function WideButton({
	label,
	onPress,
	variant,
	disabled,
}: Pick<ActionButtonProps, "label" | "onPress" | "disabled"> & {
	variant: NonNullable<ActionButtonProps["variant"]>;
}) {
	const hostTheme = useHostTheme();
	return (
		<Host
			matchContents={{ vertical: true }}
			style={{ alignSelf: "stretch", flexGrow: 1 }}
			{...hostTheme}
		>
			<SwiftButton
				onPress={onPress}
				modifiers={[
					swiftUi.buttonStyle(WIDE_STYLE[variant]),
					swiftUi.buttonBorderShape("capsule"),
					swiftUi.controlSize("large"),
					...(disabled ? [swiftUi.disabled(true)] : []),
				]}
			>
				{/* The label takes the width, and the capsule follows it. */}
				<Text modifiers={[swiftUi.frame({ maxWidth: FULL_WIDTH })]}>
					{label}
				</Text>
			</SwiftButton>
		</Host>
	);
}

/**
 * The platform's own button, through `@expo/ui`. Android draws the Material 3
 * Expressive button instead (`action-button.android.tsx`).
 */
export function ActionButton({
	label,
	onPress,
	variant = "filled",
	disabled,
	wide,
}: ActionButtonProps) {
	if (wide) {
		return (
			<WideButton
				label={label}
				onPress={onPress}
				variant={variant}
				disabled={disabled}
			/>
		);
	}
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
