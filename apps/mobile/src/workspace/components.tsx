import DateTimePicker from "@expo/ui/community/datetime-picker";
import { type ReactNode, useState } from "react";
import {
	type ColorValue,
	Platform,
	Pressable,
	TextInput,
	ToastAndroid,
	View,
} from "react-native";

import {
	datePickerBound,
	datePickerResult,
	datePickerValue,
	timePickerResult,
	timePickerValue,
} from "../time/calendar";
import { Skeleton, Text } from "../ui/components";
import { showDialog } from "../ui/dialog";
import { ControlHost } from "../ui/host";
import { Icon } from "../ui/icon";
import { LoadingIndicator } from "../ui/loading";
import { notifyError } from "../ui/notify-error";
import { useRowMenu } from "../ui/row-menu";
import type { RowMenuEntry } from "../ui/row-menu-items";
import { SettingsChoice, SettingsSection } from "../ui/settings-list";
import { useRowPosition } from "../ui/settings-list.shared";
import { usePalette } from "../ui/theme";
import { SPACE, TYPE } from "../ui/type";
import { WorkspaceIcon } from "./icon";
import type { WorkspaceIconName } from "./icons";

// The primitives of the workspace screens that the kit of `src/ui` does not
// have. They take their colours from the theme hook and sit inside a
// `SettingsSection` like the rows of the kit.

const IOS = Platform.OS === "ios";

/**
 * Asks before a change that cannot be undone, in the system's own dialog.
 * `onConfirm` runs only on the destructive button.
 */
export const confirmDestructive = ({
	title,
	message,
	action,
	onConfirm,
}: {
	title: string;
	message: string;
	/** The label of the destructive button, such as "Remove". */
	action: string;
	onConfirm: () => void;
}) =>
	showDialog(title, message, [
		{ text: "Cancel", style: "cancel" },
		{ text: action, style: "destructive", onPress: onConfirm },
	]);

/** Asks before a change that is not destructive but needs a second look. */
export const confirmAction = ({
	title,
	message,
	action,
	onConfirm,
}: {
	title: string;
	message: string;
	action: string;
	onConfirm: () => void;
}) =>
	showDialog(title, message, [
		{ text: "Cancel", style: "cancel" },
		{ text: action, onPress: onConfirm },
	]);

/**
 * A short notice that a change is done. Android shows a toast, as Material
 * does. iOS has no toast, so it shows an alert with one button.
 */
export const notify = (message: string) => {
	if (Platform.OS === "android") {
		ToastAndroid.show(message, ToastAndroid.SHORT);
		return;
	}
	showDialog(message);
};

export { notifyError };

/** A search box above a list. */
export function SearchField({
	value,
	onChangeText,
	placeholder,
}: {
	value: string;
	onChangeText: (value: string) => void;
	placeholder: string;
}) {
	const palette = usePalette();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.s,
				marginHorizontal: SPACE.l,
				paddingHorizontal: SPACE.m,
				minHeight: IOS ? 36 : 56,
				borderRadius: IOS ? 10 : 28,
				backgroundColor: palette.surfaceContainerHigh,
			}}
		>
			<Icon
				name="search"
				size={IOS ? 16 : 24}
				color={palette.onSurfaceVariant}
			/>
			<TextInput
				value={value}
				onChangeText={onChangeText}
				placeholder={placeholder}
				placeholderTextColor={palette.onSurfaceVariant}
				selectionColor={palette.primary}
				cursorColor={palette.primary}
				accessibilityLabel={placeholder}
				autoCorrect={false}
				autoCapitalize="none"
				returnKeyType="search"
				clearButtonMode="while-editing"
				style={[
					TYPE.bodyLarge,
					{ flex: 1, color: palette.onSurface, paddingVertical: SPACE.s },
				]}
			/>
			{!IOS && value !== "" ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Clear the search"
					onPress={() => onChangeText("")}
					// The icon is 20dp: 14dp on each side makes the 48dp target.
					hitSlop={{ top: 14, bottom: 14, left: 14, right: 12 }}
				>
					<Icon name="close" size={20} color={palette.onSurfaceVariant} />
				</Pressable>
			) : null}
		</View>
	);
}

/** The frame of one row inside a `SettingsSection`: the padding and, on
 *  iOS, the hairline under each row except the last. */
function RowFrame({
	children,
	onPress,
	accessibilityLabel,
	accessibilityRole,
	disabled,
	menu,
}: {
	children: ReactNode;
	/** The long-press menu of the row. */
	menu?: { title: string; items: readonly RowMenuEntry[] };
	onPress?: () => void;
	accessibilityLabel?: string;
	accessibilityRole?: "button";
	disabled?: boolean;
}) {
	const palette = usePalette();
	const { last } = useRowPosition();
	const menuProps = useRowMenu(menu?.title ?? "", menu?.items ?? []);
	return menuProps.wrap(
		<Pressable
			{...menuProps.props}
			accessible={
				Boolean(onPress) ||
				accessibilityLabel !== undefined ||
				menuProps.props.accessibilityActions != null
			}
			accessibilityRole={onPress ? (accessibilityRole ?? "button") : undefined}
			accessibilityLabel={accessibilityLabel}
			accessibilityState={onPress ? { disabled: Boolean(disabled) } : undefined}
			onPress={onPress}
			disabled={(!onPress && !menuProps.props.accessibilityActions) || disabled}
			android_ripple={{ color: palette.outlineVariant }}
			style={({ pressed }) => ({
				paddingLeft: SPACE.l,
				backgroundColor:
					IOS && pressed ? palette.surfaceContainerHigh : undefined,
				opacity: disabled ? 0.38 : 1,
			})}
		>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: IOS ? SPACE.m : SPACE.l,
					minHeight: IOS ? 44 : 56,
					paddingVertical: SPACE.m,
					paddingRight: SPACE.l,
					borderBottomWidth: IOS && !last ? 0.5 : 0,
					borderBottomColor: palette.outline,
				}}
			>
				{children}
			</View>
		</Pressable>,
	);
}

/**
 * A row that does something in place, such as "Resend" or "Archive": the
 * label in the accent colour on iOS, as the Settings app draws an action,
 * and a list item with a leading icon on Android. `destructive` draws it
 * in the error colour.
 */
export function ActionRow({
	label,
	icon,
	onPress,
	destructive,
	disabled,
	busy,
	subtitle,
}: {
	label: string;
	icon?: WorkspaceIconName;
	onPress: () => void;
	destructive?: boolean;
	disabled?: boolean;
	busy?: boolean;
	subtitle?: string;
}) {
	const palette = usePalette();
	const color = destructive ? palette.error : palette.primary;
	return (
		<RowFrame
			onPress={onPress}
			disabled={disabled || busy}
			accessibilityLabel={[label, subtitle].filter(Boolean).join(", ")}
		>
			{icon && !IOS ? (
				<WorkspaceIcon name={icon} size={24} color={color} />
			) : null}
			<View style={{ flex: 1 }}>
				<Text
					variant="bodyLarge"
					color={color}
					numberOfLines={1}
					// iOS centres the text of a destructive row, as Contacts does.
					align={IOS && destructive ? "center" : undefined}
				>
					{label}
				</Text>
				{subtitle ? (
					<Text
						variant={IOS ? "bodySmall" : "bodyMedium"}
						color={palette.onSurfaceVariant}
						numberOfLines={3}
					>
						{subtitle}
					</Text>
				) : null}
			</View>
			{busy ? <LoadingIndicator size={24} color={palette.primary} /> : null}
		</RowFrame>
	);
}

/**
 * A row with any content, inside a `SettingsSection`. Use it for a row with
 * more than a title and a value, such as a person with a badge and buttons.
 * The row is one element for a screen reader when it has `onPress`.
 */
export function CustomRow({
	children,
	onPress,
	accessibilityLabel,
}: {
	children: ReactNode;
	onPress?: () => void;
	accessibilityLabel?: string;
}) {
	return (
		<RowFrame onPress={onPress} accessibilityLabel={accessibilityLabel}>
			{children}
		</RowFrame>
	);
}

/** A row with a title, a second line, a trailing part and an optional
 *  chevron (iOS) for a row that opens a screen. */
export function DetailRow({
	title,
	subtitle,
	trailing,
	onPress,
	accessibilityLabel,
	muted,
	actions,
}: {
	title: string;
	subtitle?: string;
	trailing?: ReactNode;
	onPress?: () => void;
	accessibilityLabel?: string;
	/** The long-press menu, and the same actions for a screen reader. The
	 *  caller leaves out an action that the person may not do. */
	actions?: readonly RowMenuEntry[];
	/** Draws the title in the colour for a secondary line, such as for an
	 *  archived row. */
	muted?: boolean;
}) {
	const palette = usePalette();
	return (
		<RowFrame
			onPress={onPress}
			menu={{ title, items: actions ?? [] }}
			accessibilityLabel={
				accessibilityLabel ?? [title, subtitle].filter(Boolean).join(", ")
			}
		>
			<View style={{ flex: 1 }}>
				<Text
					variant="bodyLarge"
					color={muted ? palette.onSurfaceVariant : palette.onSurface}
					numberOfLines={1}
				>
					{title}
				</Text>
				{subtitle ? (
					<Text
						variant={IOS ? "bodySmall" : "bodyMedium"}
						color={palette.onSurfaceVariant}
						numberOfLines={2}
					>
						{subtitle}
					</Text>
				) : null}
			</View>
			{trailing}
			{IOS && onPress ? (
				<Icon name="forward" size={14} color={palette.outline} />
			) : null}
		</RowFrame>
	);
}

export type BadgeTone = "neutral" | "accent" | "error" | "success";

/** A small label beside a row's title, such as "Archived" or "Email failed". */
export function Badge({
	label,
	tone = "neutral",
}: {
	label: string;
	tone?: BadgeTone;
}) {
	const palette = usePalette();
	const colors = {
		neutral: [palette.surfaceContainerHigh, palette.onSurfaceVariant],
		accent: [palette.secondaryContainer, palette.onSecondaryContainer],
		error: [palette.errorContainer, palette.onErrorContainer],
		success: [palette.primaryContainer, palette.onPrimaryContainer],
	} satisfies { [tone in BadgeTone]: [ColorValue, ColorValue] };
	const [background, foreground] = colors[tone];
	return (
		<View
			style={{
				paddingHorizontal: SPACE.s,
				paddingVertical: 2,
				borderRadius: IOS ? 6 : 8,
				backgroundColor: background,
			}}
		>
			<Text variant="labelMedium" color={foreground} numberOfLines={1}>
				{label}
			</Text>
		</View>
	);
}

/** Grey rows while a list loads. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
	return (
		<View style={{ paddingHorizontal: SPACE.l, gap: SPACE.s }}>
			{Array.from({ length: rows }, (_, index) => (
				<Skeleton key={index} height={IOS ? 44 : 56} radius={IOS ? 10 : 16} />
			))}
		</View>
	);
}

export type Option<T extends string | number> = {
	value: T;
	label: string;
	subtitle?: string;
};

/** A section that holds a choice of one option, with a check on the chosen
 *  one. A press on another option calls `onChange` with it. */
export function ChoiceSection<T extends string | number>({
	title,
	footer,
	options,
	value,
	onChange,
	disabled,
}: {
	title?: string;
	footer?: string;
	options: readonly Option<T>[];
	value: T | null;
	onChange: (value: T) => void;
	disabled?: boolean;
}) {
	return (
		<SettingsSection title={title} footer={footer}>
			{options.map((option) => (
				<SettingsChoice
					key={String(option.value)}
					title={option.label}
					subtitle={option.subtitle}
					selected={option.value === value}
					onPress={() => {
						if (disabled || option.value === value) return;
						onChange(option.value);
					}}
				/>
			))}
		</SettingsSection>
	);
}

/**
 * A row with a day or a time and the system picker. iOS draws the compact
 * picker at the end of the row. Android shows the value, and a press opens
 * the Material dialog.
 */
export function PickerRow({
	title,
	mode,
	value,
	display,
	onChange,
	placeholder = "Not set",
	disabled,
	minimum,
	maximum,
}: {
	title: string;
	mode: "date" | "time";
	/** A day key (yyyy-MM-dd) for a date, "HH:mm" for a time, or null. */
	value: string | null;
	/** The text of the value on Android. The value itself when not given. */
	display?: string;
	onChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	/** The first day that can be picked, yyyy-MM-dd. */
	minimum?: string;
	/** The last day that can be picked, yyyy-MM-dd. */
	maximum?: string;
}) {
	const palette = usePalette();
	const [open, setOpen] = useState(false);
	const platform = IOS ? "ios" : "android";
	const toDate = (key: string) =>
		mode === "date" ? datePickerValue(key, platform) : timePickerValue(key);
	const fromDate = (date: Date) =>
		mode === "date" ? datePickerResult(date, platform) : timePickerResult(date);
	const current = value === null ? new Date() : toDate(value);
	const bounds = {
		minimumDate: minimum ? datePickerBound(minimum) : undefined,
		maximumDate: maximum ? datePickerBound(maximum) : undefined,
	};

	if (IOS && (value !== null || open)) {
		return (
			<RowFrame>
				<View style={{ flex: 1 }}>
					<Text variant="bodyLarge" numberOfLines={1}>
						{title}
					</Text>
				</View>
				<ControlHost>
					<DateTimePicker
						value={current}
						mode={mode}
						display="compact"
						disabled={disabled}
						{...bounds}
						onValueChange={(_, date) => onChange(fromDate(date))}
					/>
				</ControlHost>
			</RowFrame>
		);
	}

	const shown = value === null ? placeholder : (display ?? value);
	return (
		<>
			<RowFrame
				onPress={disabled ? undefined : () => setOpen(true)}
				accessibilityLabel={`${title}, ${shown}`}
			>
				<View style={{ flex: 1 }}>
					<Text variant="bodyLarge" numberOfLines={1}>
						{title}
					</Text>
				</View>
				<Text
					variant={IOS ? "bodyLarge" : "bodyMedium"}
					color={value === null ? palette.onSurfaceVariant : palette.primary}
				>
					{shown}
				</Text>
			</RowFrame>
			{open && !IOS ? (
				// The dialog opens in its own window. The host of the Compose view
				// takes no room in the row.
				<View style={{ position: "absolute", width: 0, height: 0 }}>
					<DateTimePicker
						value={current}
						mode={mode}
						is24Hour
						{...bounds}
						onValueChange={(_, date) => {
							setOpen(false);
							onChange(fromDate(date));
						}}
						onDismiss={() => setOpen(false)}
					/>
				</View>
			) : null}
		</>
	);
}

/** A line of text inside a section, such as a hint or an empty list. */
export function NoteRow({ children }: { children: string }) {
	const palette = usePalette();
	return (
		<RowFrame accessibilityLabel={children}>
			<View style={{ flex: 1 }}>
				<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
					{children}
				</Text>
			</View>
		</RowFrame>
	);
}
