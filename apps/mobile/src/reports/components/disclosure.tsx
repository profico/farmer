import type { ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";

import { Text } from "../../ui/components";
import { Icon } from "../../ui/icon";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import { ShareBar } from "./bars";

/**
 * The summary row of a group: a press opens the entries under it. The
 * caret turns down when it is open. With `onPress` instead, the row opens
 * a screen and shows the forward icon.
 */
export function SummaryRow({
	title,
	subtitle,
	value,
	share,
	open,
	onToggle,
	onPress,
	accessibilityHint,
}: {
	title: string;
	subtitle?: string;
	/** The hours, already written. */
	value?: string;
	/** The bar: this row's figure and the largest of the list. */
	share?: { value: number; max: number };
	open?: boolean;
	onToggle?: () => void;
	onPress?: () => void;
	accessibilityHint?: string;
}) {
	const palette = usePalette();
	const press = onToggle ?? onPress;
	return (
		<Pressable
			accessible
			accessibilityRole="button"
			accessibilityLabel={[title, subtitle, value ? `${value} hours` : ""]
				.filter(Boolean)
				.join(", ")}
			accessibilityHint={accessibilityHint}
			accessibilityState={onToggle ? { expanded: Boolean(open) } : undefined}
			onPress={press}
			disabled={!press}
			android_ripple={{ color: palette.outlineVariant }}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.m,
				minHeight: 56,
				paddingHorizontal: SPACE.l,
				paddingVertical: SPACE.s,
				backgroundColor:
					Platform.OS === "ios" && pressed
						? palette.surfaceContainerHigh
						: undefined,
			})}
		>
			{onToggle ? (
				<View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
					<Icon name="forward" size={20} color={palette.onSurfaceVariant} />
				</View>
			) : null}
			<View style={{ flex: 1, gap: SPACE.xs }}>
				<View style={{ flexDirection: "row", gap: SPACE.s }}>
					<View style={{ flex: 1 }}>
						<Text variant="bodyLarge" numberOfLines={2}>
							{title}
						</Text>
					</View>
					{value ? <Text variant="titleSmall">{value}</Text> : null}
				</View>
				{subtitle ? (
					<Text variant="bodySmall" color={palette.onSurfaceVariant}>
						{subtitle}
					</Text>
				) : null}
				{share ? <ShareBar value={share.value} max={share.max} /> : null}
			</View>
			{onPress && !onToggle ? (
				<Icon name="forward" size={20} color={palette.onSurfaceVariant} />
			) : null}
		</Pressable>
	);
}

/** One entry under an open group: what, when, a note and the hours. */
export function EntryLine({
	title,
	detail,
	note,
	value,
	overtime,
}: {
	title: string;
	detail?: string;
	/** The description. An empty one says "No description". */
	note: string;
	value: string;
	overtime?: boolean;
}) {
	const palette = usePalette();
	return (
		<View
			accessible
			accessibilityLabel={[
				title,
				detail,
				note || "No description",
				`${value} hours`,
				overtime ? "Overtime" : undefined,
			]
				.filter(Boolean)
				.join(", ")}
			style={{
				flexDirection: "row",
				gap: SPACE.m,
				paddingVertical: SPACE.s,
				paddingLeft: SPACE.xxl + SPACE.s,
				paddingRight: SPACE.l,
			}}
		>
			<View style={{ flex: 1 }}>
				<Text variant="bodyMedium">{title}</Text>
				{detail ? (
					<Text variant="bodySmall" color={palette.onSurfaceVariant}>
						{detail}
					</Text>
				) : null}
				<Text
					variant="bodySmall"
					color={note ? palette.onSurfaceVariant : palette.outline}
					numberOfLines={3}
				>
					{note || "No description"}
				</Text>
			</View>
			<View style={{ alignItems: "flex-end", gap: SPACE.xs }}>
				<Text variant="bodyMedium">{value}</Text>
				{overtime ? (
					<Text variant="labelMedium" color={palette.tertiary}>
						OT
					</Text>
				) : null}
			</View>
		</View>
	);
}

/** A group of rows on a surface, as the lists of the app draw them. */
export function ListCard({ children }: { children: ReactNode }) {
	const palette = usePalette();
	return (
		<View
			style={{
				marginHorizontal: SPACE.l,
				borderRadius: Platform.OS === "ios" ? 12 : 16,
				overflow: "hidden",
				backgroundColor: palette.surfaceContainer,
			}}
		>
			{children}
		</View>
	);
}

/** A line of text in the muted colour, such as a note under a list. */
export function Note({ children }: { children: string }) {
	const palette = usePalette();
	return (
		<View style={{ paddingHorizontal: SPACE.l }}>
			<Text variant="bodySmall" color={palette.onSurfaceVariant}>
				{children}
			</Text>
		</View>
	);
}
