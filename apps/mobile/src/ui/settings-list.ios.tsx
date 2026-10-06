import { Switch } from "@expo/ui";
import type { ReactNode } from "react";
import { type ColorValue, PlatformColor, Pressable, View } from "react-native";

import { Text } from "./components";
import { ControlHost } from "./host";
import { Icon } from "./icon";
import type { IconName } from "./icons";
import { useRowMenu } from "./row-menu";
import {
	type RowBase,
	type RowTint,
	rowsWithPosition,
	type SettingsChoiceProps,
	type SettingsLinkProps,
	type SettingsSectionProps,
	type SettingsSwitchProps,
	type SettingsValueProps,
	useRowPosition,
} from "./settings-list.shared";
import { usePalette } from "./theme";
import { SPACE } from "./type";

// The grouped lists of the iOS Settings app: an inset group with rounded
// corners, a caption above it in small capitals, a coloured tile for each
// icon, a hairline between rows from the start of the text, and a chevron
// on a row that opens a screen.

const TILE = 29;
const ROW_INSET = SPACE.l;

const TINTS = {
	blue: PlatformColor("systemBlue"),
	green: PlatformColor("systemGreen"),
	orange: PlatformColor("systemOrange"),
	red: PlatformColor("systemRed"),
	purple: PlatformColor("systemPurple"),
	indigo: PlatformColor("systemIndigo"),
	teal: PlatformColor("systemTeal"),
	pink: PlatformColor("systemPink"),
	gray: PlatformColor("systemGray"),
} satisfies { [tint in RowTint]: ColorValue };

export function SettingsSection({
	title,
	footer,
	children,
}: SettingsSectionProps) {
	const palette = usePalette();
	return (
		<View style={{ gap: 6 }}>
			{title ? (
				<View style={{ paddingHorizontal: SPACE.l + ROW_INSET }}>
					<Text variant="bodySmall" color={palette.onSurfaceVariant}>
						{title.toUpperCase()}
					</Text>
				</View>
			) : null}
			<View
				style={{
					marginHorizontal: SPACE.l,
					borderRadius: 10,
					overflow: "hidden",
					backgroundColor: palette.surfaceContainer,
				}}
			>
				{rowsWithPosition(children)}
			</View>
			{footer ? (
				<View style={{ paddingHorizontal: SPACE.l + ROW_INSET }}>
					<Text variant="bodySmall" color={palette.onSurfaceVariant}>
						{footer}
					</Text>
				</View>
			) : null}
		</View>
	);
}

function Tile({ icon, tint }: { icon: IconName; tint: RowTint }) {
	return (
		<View
			style={{
				width: TILE,
				height: TILE,
				borderRadius: 7,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: TINTS[tint],
			}}
		>
			<Icon name={icon} size={17} color="#ffffff" weight="medium" />
		</View>
	);
}

function Row({
	icon,
	tint = "gray",
	title,
	subtitle,
	actions,
	trailing,
	onPress,
	destructive,
	accessibilityLabel,
	grouped = true,
	selected,
	hasValue,
}: RowBase & {
	trailing?: ReactNode;
	onPress?: () => void;
	destructive?: boolean;
	accessibilityLabel: string;
	/** False when a control in the row must stay reachable on its own. */
	grouped?: boolean;
	/** Set for an option of a choice. */
	selected?: boolean;
	/** A value shows at the end. A long value gives way to the title, not
	 *  the other way round. */
	hasValue?: boolean;
}) {
	const palette = usePalette();
	const menu = useRowMenu(title, actions ?? []);
	const { last } = useRowPosition();
	return menu.wrap(
		<Pressable
			{...menu.props}
			accessible={grouped}
			accessibilityRole={onPress ? "button" : undefined}
			accessibilityState={selected !== undefined ? { selected } : undefined}
			accessibilityLabel={grouped ? accessibilityLabel : undefined}
			onPress={onPress}
			disabled={!onPress && !menu.props.accessibilityActions}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.m,
				minHeight: 44,
				paddingLeft: ROW_INSET,
				backgroundColor: pressed ? palette.surfaceContainerHigh : undefined,
			})}
		>
			{icon ? <Tile icon={icon} tint={tint} /> : null}
			<View
				style={{
					flex: 1,
					flexDirection: "row",
					alignItems: "center",
					gap: SPACE.s,
					alignSelf: "stretch",
					paddingVertical: SPACE.m,
					paddingRight: ROW_INSET,
					borderBottomWidth: last ? 0 : 0.5,
					borderBottomColor: palette.outline,
				}}
			>
				<View
					style={hasValue ? { flexShrink: 0, maxWidth: "60%" } : { flex: 1 }}
				>
					<Text
						variant="bodyLarge"
						color={destructive ? palette.error : palette.onSurface}
						numberOfLines={1}
					>
						{title}
					</Text>
					{subtitle ? (
						<Text
							variant="bodySmall"
							color={palette.onSurfaceVariant}
							numberOfLines={2}
						>
							{subtitle}
						</Text>
					) : null}
				</View>
				{trailing}
			</View>
		</Pressable>,
	);
}

/** The value at the end of a row: one line. */
function Value({ children }: { children: string }) {
	const palette = usePalette();
	return (
		<View style={{ flex: 1, alignItems: "flex-end" }}>
			<Text
				variant="bodyLarge"
				color={palette.onSurfaceVariant}
				numberOfLines={1}
			>
				{children}
			</Text>
		</View>
	);
}

const labelOf = (...parts: (string | undefined)[]) =>
	parts.filter((part) => part).join(", ");

export function SettingsLink({
	value,
	destructive,
	external,
	onPress,
	...row
}: SettingsLinkProps) {
	return (
		<Row
			{...row}
			onPress={onPress}
			destructive={destructive}
			hasValue={Boolean(value)}
			accessibilityLabel={labelOf(row.title, row.subtitle, value)}
			trailing={
				<>
					{value ? <Value>{value}</Value> : null}
					{destructive ? null : (
						<Icon
							name={external ? "external" : "forward"}
							size={external ? 12 : 13}
							weight="semibold"
							color={PlatformColor(
								external ? "secondaryLabel" : "tertiaryLabel",
							)}
						/>
					)}
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
					<Icon name="check" size={17} color={palette.primary} />
				) : null
			}
		/>
	);
}

/** A row with a switch. On iOS only the switch flips it, not the row. */
export function SettingsSwitch({
	value,
	onValueChange,
	disabled,
	...row
}: SettingsSwitchProps) {
	return (
		<Row
			{...row}
			accessibilityLabel={labelOf(row.title, row.subtitle)}
			grouped={false}
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

export function SettingsValue({ value, onPress, ...row }: SettingsValueProps) {
	return (
		<Row
			{...row}
			onPress={onPress}
			hasValue={value !== ""}
			accessibilityLabel={labelOf(row.title, row.subtitle, value)}
			trailing={
				<>
					{value === "" ? null : <Value>{value}</Value>}
					{onPress ? (
						<Icon
							name="forward"
							size={13}
							weight="semibold"
							color={PlatformColor("tertiaryLabel")}
						/>
					) : null}
				</>
			}
		/>
	);
}
