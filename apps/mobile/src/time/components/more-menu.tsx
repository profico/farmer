import { MenuView } from "@expo/ui/community/menu";
import { Platform, View } from "react-native";

import { usePalette } from "../../ui/theme";
import { minTargetFor } from "../../ui/touch-target";
import { MoreIcon } from "./more-icon";

/** The anchor is a touch target: 48 dp on Android, 44 pt on iOS. */
const TARGET = minTargetFor(Platform.OS);

export type MoreAction = {
	id: string;
	title: string;
	/** Shown, but not available. */
	disabled?: boolean;
};

/**
 * The system menu of more actions, for the end of a title row: a SwiftUI
 * menu on iOS and a Material dropdown menu on Android.
 */
export function MoreMenu({
	actions,
	onAction,
	label = "More actions",
}: {
	actions: MoreAction[];
	onAction: (id: string) => void;
	label?: string;
}) {
	const palette = usePalette();
	return (
		<MenuView
			actions={actions.map((action) => ({
				id: action.id,
				title: action.title,
				attributes: action.disabled ? { disabled: true } : undefined,
			}))}
			onPressAction={(event) => onAction(event.nativeEvent.event)}
		>
			<View
				accessible
				accessibilityRole="button"
				accessibilityLabel={label}
				style={{
					width: TARGET,
					height: TARGET,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<MoreIcon color={palette.onSurfaceVariant} />
			</View>
		</MenuView>
	);
}
