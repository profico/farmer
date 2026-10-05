import { Switch } from "@expo/ui";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Text } from "./components";
import { ControlHost } from "./host";
import { Icon } from "./icon";
import {
	type RowBase,
	rowsWithPosition,
	type SettingsChoiceProps,
	type SettingsLinkProps,
	type SettingsSectionProps,
	type SettingsSwitchProps,
	type SettingsValueProps,
} from "./settings-list.shared";
import { usePalette } from "./theme";
import { SPACE } from "./type";

/**
 * A small kit for a settings screen: a section of rows, a row that opens a
 * screen, a row with a switch and a row with a value. This file draws them
 * as Material 3 list items, for Android; `settings-list.ios.tsx` draws the
 * grouped lists of the iOS Settings app. Both take the same props
 * (`settings-list.shared.tsx`).
 */

export type { RowTint } from "./settings-list.shared";

export function SettingsSection({
	title,
	footer,
	children,
}: SettingsSectionProps) {
	const palette = usePalette();
	return (
		<View style={{ gap: SPACE.xs }}>
			{title ? (
				<View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.s }}>
					<Text variant="titleSmall" color={palette.primary}>
						{title}
					</Text>
				</View>
			) : null}
			<View
				style={{
					marginHorizontal: SPACE.l,
					borderRadius: 16,
					overflow: "hidden",
					backgroundColor: palette.surfaceContainer,
				}}
			>
				{rowsWithPosition(children)}
			</View>
			{footer ? (
				<View style={{ paddingHorizontal: SPACE.xl }}>
					<Text variant="bodySmall" color={palette.onSurfaceVariant}>
						{footer}
					</Text>
				</View>
			) : null}
		</View>
	);
}

function Row({
	icon,
	title,
	subtitle,
	trailing,
	onPress,
	destructive,
	accessibilityLabel,
	checked,
	selected,
}: RowBase & {
	trailing?: ReactNode;
	onPress?: () => void;
	destructive?: boolean;
	accessibilityLabel: string;
	/** Set for a switch row, which a screen reader reads as a switch. */
	checked?: boolean;
	/** Set for an option of a choice. */
	selected?: boolean;
}) {
	const palette = usePalette();
	const color = destructive ? palette.error : palette.onSurface;
	return (
		<Pressable
			accessible
			accessibilityRole={
				checked !== undefined ? "switch" : onPress ? "button" : undefined
			}
			accessibilityState={
				checked !== undefined
					? { checked }
					: selected !== undefined
						? { selected }
						: undefined
			}
			accessibilityLabel={accessibilityLabel}
			onPress={onPress}
			disabled={!onPress}
			android_ripple={{ color: palette.outlineVariant }}
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.l,
				minHeight: subtitle ? 72 : 56,
				paddingHorizontal: SPACE.l,
				paddingVertical: SPACE.s,
			}}
		>
			{icon ? (
				<Icon
					name={icon}
					size={24}
					color={destructive ? palette.error : palette.onSurfaceVariant}
				/>
			) : null}
			<View style={{ flex: 1 }}>
				<Text variant="bodyLarge" color={color} numberOfLines={1}>
					{title}
				</Text>
				{subtitle ? (
					<Text
						variant="bodyMedium"
						color={palette.onSurfaceVariant}
						numberOfLines={2}
					>
						{subtitle}
					</Text>
				) : null}
			</View>
			{trailing}
		</Pressable>
	);
}

const labelOf = (...parts: (string | undefined)[]) =>
	parts.filter((part) => part).join(", ");

/** A row that opens a screen. Material draws no chevron on a list item, so
 *  only a link out of the app has a trailing icon here. */
export function SettingsLink({
	value,
	destructive,
	external,
	onPress,
	...row
}: SettingsLinkProps) {
	const palette = usePalette();
	return (
		<Row
			{...row}
			onPress={onPress}
			destructive={destructive}
			accessibilityLabel={labelOf(row.title, row.subtitle, value)}
			trailing={
				<>
					{value ? (
						<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
							{value}
						</Text>
					) : null}
					{external ? (
						<Icon name="web" size={20} color={palette.onSurfaceVariant} />
					) : null}
				</>
			}
		/>
	);
}

/** One option of a choice. The chosen one has a check icon. */
export function SettingsChoice({
	selected,
	onPress,
	...row
}: SettingsChoiceProps) {
	const palette = usePalette();
	return (
		<Row
			{...row}
			onPress={onPress}
			accessibilityLabel={labelOf(row.title, row.subtitle)}
			selected={selected}
			trailing={
				selected ? (
					<Icon name="check" size={22} color={palette.primary} />
				) : null
			}
		/>
	);
}

/** A row with a switch. A press on the row flips it, as on Android. */
export function SettingsSwitch({
	value,
	onValueChange,
	disabled,
	...row
}: SettingsSwitchProps) {
	return (
		<Row
			{...row}
			onPress={disabled ? undefined : () => onValueChange(!value)}
			accessibilityLabel={labelOf(row.title, row.subtitle)}
			checked={value}
			trailing={
				<ControlHost>
					<Switch
						value={value}
						onValueChange={onValueChange}
						disabled={disabled}
					/>
				</ControlHost>
			}
		/>
	);
}

/** A row that shows a value, and can open a screen to change it. */
export function SettingsValue({ value, onPress, ...row }: SettingsValueProps) {
	const palette = usePalette();
	return (
		<Row
			{...row}
			onPress={onPress}
			accessibilityLabel={labelOf(row.title, row.subtitle, value)}
			trailing={
				<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
					{value}
				</Text>
			}
		/>
	);
}
