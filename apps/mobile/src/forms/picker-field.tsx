import { useContext, type ReactNode } from "react";
import { Platform, Pressable, Text as RNText, View } from "react-native";

import { Text } from "../ui/components";
import { RADIUS, cornerFor } from "../ui/corner";
import { Icon } from "../ui/icon";
import { SurfaceColor } from "../ui/surface-color";
import { usePalette } from "../ui/theme";
import { SPACE, TYPE } from "../ui/type";

const HEIGHT = 56;

/**
 * A select field. On Android it is the outlined field of Material 3 with the
 * label on the outline. On iOS the label sits above the box. A tap opens the
 * full-screen selector, so the field shows the chosen value and an arrow.
 */
export function PickerField({
	label,
	title,
	subtitle,
	leading,
	empty,
	onPress,
}: {
	label: string;
	title: string;
	subtitle?: string;
	/** A mark before the title, for example the mark of a project. */
	leading?: ReactNode;
	/** The title is a placeholder, not a value. */
	empty?: boolean;
	onPress: () => void;
}) {
	const palette = usePalette();
	const surface = useContext(SurfaceColor);
	const android = Platform.OS === "android";
	return (
		<View style={{ gap: SPACE.xs }}>
			{android ? null : (
				<RNText style={[TYPE.labelMedium, { color: palette.onSurfaceVariant }]}>
					{label}
				</RNText>
			)}
			<View style={{ paddingTop: android ? SPACE.s : 0 }}>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={
						empty
							? `${label}, ${title}`
							: `${label}, ${title}${subtitle ? `, ${subtitle}` : ""}`
					}
					onPress={onPress}
					android_ripple={{ color: palette.outlineVariant }}
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: SPACE.m,
						minHeight: HEIGHT,
						paddingHorizontal: SPACE.l,
						paddingVertical: SPACE.s,
						borderRadius: android ? RADIUS.field : cornerFor("field", "ios"),
						borderWidth: 1,
						borderColor: palette.outline,
						overflow: "hidden",
					}}
				>
					{leading}
					<View style={{ flex: 1 }}>
						<Text
							variant="bodyLarge"
							color={empty ? palette.onSurfaceVariant : undefined}
							numberOfLines={1}
						>
							{title}
						</Text>
						{subtitle ? (
							<Text
								variant="bodyMedium"
								color={palette.onSurfaceVariant}
								numberOfLines={1}
							>
								{subtitle}
							</Text>
						) : null}
					</View>
					<Icon name="expand" size={24} color={palette.onSurfaceVariant} />
				</Pressable>
				{android ? (
					<View
						// The label sits on the outline. A touch goes to the field.
						pointerEvents="none"
						accessibilityElementsHidden
						importantForAccessibility="no-hide-descendants"
						style={{
							position: "absolute",
							left: SPACE.l - SPACE.xs,
							top: 0,
							paddingHorizontal: SPACE.xs,
							backgroundColor: surface ?? palette.background,
						}}
					>
						<RNText
							numberOfLines={1}
							style={[TYPE.bodySmall, { color: palette.onSurfaceVariant }]}
						>
							{label}
						</RNText>
					</View>
				) : null}
			</View>
		</View>
	);
}
