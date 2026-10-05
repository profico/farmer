import type { ReminderSettingsPatch } from "@farmer/api-client";
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { View } from "react-native";

import { useUpdateReminderSettings } from "../../api/workspace";
import { IconButton, Text } from "../../ui/components";
import {
	SettingsChoice,
	SettingsLink,
	SettingsSection,
	SettingsSwitch,
} from "../../ui/settings-list";
import { usePalette } from "../../ui/theme";
import {
	ActionRow,
	CustomRow,
	NoteRow,
	notifyError,
	PickerRow,
} from "../components";
import {
	MEMBER_TYPE_LABELS,
	MEMBER_TYPES,
	type MemberType,
	sameSlice,
	TIME_HINT,
	toggleIn,
	toQuarterHour,
} from "./model";

// The pieces that the four reminder sections share.

/** A number with a minus and a plus button. A press stays inside the limits,
 *  so the field never holds a value that the server refuses. */
export function StepperRow({
	title,
	value,
	min,
	max,
	step = 1,
	suffix,
	onChange,
}: {
	title: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	suffix?: string;
	onChange: (value: number) => void;
}) {
	const palette = usePalette();
	const shown = suffix ? `${value}${suffix}` : String(value);
	return (
		<CustomRow>
			<View style={{ flex: 1 }}>
				<Text variant="bodyLarge" numberOfLines={2}>
					{title}
				</Text>
			</View>
			<IconButton
				icon="minus"
				label={`Decrease: ${title}`}
				disabled={value <= min}
				onPress={() => onChange(Math.max(min, value - step))}
			/>
			<View style={{ minWidth: 44, alignItems: "center" }}>
				<Text variant="bodyLarge" color={palette.onSurface}>
					{shown}
				</Text>
			</View>
			<IconButton
				icon="add"
				label={`Increase: ${title}`}
				disabled={value >= max}
				onPress={() => onChange(Math.min(max, value + step))}
			/>
		</CustomRow>
	);
}

/** The time of a reminder, with the limits as the footer. */
export function TimeSection({
	value,
	onChange,
}: {
	value: string;
	onChange: (time: string) => void;
}) {
	return (
		<SettingsSection footer={TIME_HINT}>
			<PickerRow
				title="Time"
				mode="time"
				value={value}
				onChange={(time) => onChange(toQuarterHour(time))}
			/>
		</SettingsSection>
	);
}

/** A multi-select of the person types, with a check on each chosen one. */
export function MemberTypesSection({
	value,
	onChange,
}: {
	value: readonly MemberType[];
	onChange: (types: MemberType[]) => void;
}) {
	return (
		<SettingsSection title="Who" footer="Overhead employees never get it.">
			{MEMBER_TYPES.map((type) => (
				<SettingsChoice
					key={type}
					title={MEMBER_TYPE_LABELS[type]}
					selected={value.includes(type)}
					// Rebuilt from the constant, so the stored order never depends on
					// the order of the presses.
					onPress={() =>
						onChange(
							MEMBER_TYPES.filter((item) =>
								toggleIn(value, type).includes(item),
							),
						)
					}
				/>
			))}
		</SettingsSection>
	);
}

/**
 * One reminder. The switch saves at once, as on the web. The fields are a
 * draft with a Save row, so a half-set time is never sent to the whole
 * workspace. The parent gives the section a `key` of the saved slice, so
 * the draft starts again after a save.
 */
export function ReminderBlock<T extends ReminderSettingsPatch>({
	kind,
	title,
	description,
	enabled,
	enabledPatch,
	saved,
	problemOf,
	children,
}: {
	kind: string;
	title: string;
	description: string;
	enabled: boolean;
	/** The patch that turns the reminder on or off. */
	enabledPatch: (on: boolean) => ReminderSettingsPatch;
	saved: T;
	problemOf: (draft: T) => string | null;
	children: (draft: T, set: (patch: Partial<T>) => void) => ReactNode;
}) {
	const router = useRouter();
	const update = useUpdateReminderSettings();
	const [draft, setDraft] = useState(saved);
	const changed = !sameSlice(draft, saved);
	const problem = problemOf(draft);
	return (
		<>
			<SettingsSection title={title} footer={description}>
				<SettingsSwitch
					title={`${title} on`}
					value={enabled}
					disabled={update.isPending}
					onValueChange={(on) =>
						update.mutate(enabledPatch(on), {
							onError: (error) =>
								notifyError(`Could not turn ${title} on or off`, error),
						})
					}
				/>
				<SettingsLink
					icon="people"
					title="Who gets it"
					subtitle="Preview with the saved settings"
					onPress={() =>
						router.push({
							pathname: "/workspace/reminders/preview",
							params: { kind },
						})
					}
				/>
			</SettingsSection>
			{children(draft, (patch) => setDraft({ ...draft, ...patch }))}
			<SettingsSection>
				<ActionRow
					label="Save"
					busy={update.isPending}
					disabled={!changed || problem !== null}
					onPress={() =>
						update.mutate(draft, {
							onError: (error) => notifyError(`Could not save ${title}`, error),
						})
					}
				/>
				{changed ? (
					<ActionRow
						label="Discard changes"
						destructive
						onPress={() => setDraft(saved)}
					/>
				) : null}
				{problem ? <NoteRow>{problem}</NoteRow> : null}
			</SettingsSection>
		</>
	);
}
