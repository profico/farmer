import { useLocalSearchParams } from "expo-router";
import { Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useWhoami } from "../../../src/api/queries";
import {
	type ReminderKind,
	useReminderPreview,
} from "../../../src/api/workspace";
import { ErrorState, Text } from "../../../src/ui/components";
import { Screen } from "../../../src/ui/screen";
import { SettingsSection } from "../../../src/ui/settings-list";
import { usePalette } from "../../../src/ui/theme";
import { SPACE } from "../../../src/ui/type";
import {
	ChoiceSection,
	CustomRow,
	DetailRow,
	ListSkeleton,
	NoteRow,
	PickerRow,
} from "../../../src/workspace/components";
import { formatDay, peopleCount } from "../../../src/workspace/format";
import { paramOf } from "../../../src/workspace/params";

const KINDS = [
	{ value: "log-reminder", label: "Log reminder" },
	{ value: "compliance-nudge", label: "Slack nudge" },
	{ value: "month-end", label: "Month-end reminder" },
	{ value: "admin-digest", label: "Admin digest" },
] as const satisfies readonly { value: ReminderKind; label: string }[];

/** The kind from the route, or the first one when it is missing or wrong. */
const kindOf = (value: string | undefined): ReminderKind =>
	KINDS.find((kind) => kind.value === value)?.value ?? "log-reminder";

/** Who gets a reminder on a day, by the saved settings. It runs the same
 *  selection as the job, so an admin sees the effect before anybody gets a
 *  message. */
export default function ReminderPreviewScreen() {
	const params = useLocalSearchParams<{ kind?: string; date?: string }>();
	const whoami = useWhoami();
	const [kind, setKind] = useState(() => kindOf(paramOf(params.kind)));
	const [picked, setPicked] = useState<string | null>(
		paramOf(params.date) ?? null,
	);
	const date = picked ?? whoami.data?.today ?? null;
	return (
		<>
			<Stack.Screen options={{ title: "Who gets it" }} />
			{date === null ? (
				<Screen topInset={false}>
					<ListSkeleton rows={3} />
				</Screen>
			) : (
				<PreviewBody
					kind={kind}
					date={date}
					onKind={setKind}
					onDate={setPicked}
				/>
			)}
		</>
	);
}

function PreviewBody({
	kind,
	date,
	onKind,
	onDate,
}: {
	kind: ReminderKind;
	date: string;
	onKind: (kind: ReminderKind) => void;
	onDate: (date: string) => void;
}) {
	const palette = usePalette();
	const preview = useReminderPreview(kind, date ?? "");
	const data = preview.data;
	return (
		<Screen
			topInset={false}
			refreshing={preview.isRefetching}
			onRefresh={() => void preview.refetch()}
		>
			<ChoiceSection
				title="Reminder"
				footer="By the saved settings. The preview ignores the time of day and what already went out."
				options={KINDS}
				value={kind}
				onChange={onKind}
			/>
			<SettingsSection>
				<PickerRow
					title="Date"
					mode="date"
					value={date}
					display={formatDay(date)}
					onChange={onDate}
				/>
			</SettingsSection>
			{preview.isPending ? (
				<ListSkeleton rows={3} />
			) : !data ? (
				<ErrorState
					error={preview.error}
					onRetry={() => void preview.refetch()}
				/>
			) : data.skipped ? (
				<SettingsSection title="Nothing goes out">
					<NoteRow>{data.skipped}</NoteRow>
				</SettingsSection>
			) : (
				<>
					<SettingsSection
						title="Summary"
						footer={
							data.sendsAt
								? `Goes out at ${data.sendsAt} to ${peopleCount(data.recipients.length)}.`
								: `Goes out at the end of each person's workday to ${peopleCount(data.recipients.length)}.`
						}
					>
						{data.recipients.length === 0 ? (
							<NoteRow>Nobody gets it on this date.</NoteRow>
						) : (
							data.recipients.map((person) => (
								<CustomRow
									key={person.userId}
									accessibilityLabel={`${person.name}, ${person.reason}. ${person.message}`}
								>
									<View style={{ flex: 1, gap: SPACE.xs }}>
										<Text variant="bodyLarge">{person.name}</Text>
										<Text variant="bodySmall" color={palette.onSurfaceVariant}>
											{person.email}
										</Text>
										<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
											{person.reason}
										</Text>
										<View
											style={{
												borderRadius: 8,
												padding: SPACE.s,
												backgroundColor: palette.surfaceContainerHigh,
											}}
										>
											<Text
												variant="bodySmall"
												color={palette.onSurfaceVariant}
											>
												{person.message}
											</Text>
										</View>
									</View>
								</CustomRow>
							))
						)}
					</SettingsSection>
					{data.heldBack.length > 0 ? (
						<SettingsSection title="Held back">
							{data.heldBack.map((person) => (
								<DetailRow
									key={person.userId}
									title={person.name}
									subtitle={person.reason}
								/>
							))}
						</SettingsSection>
					) : null}
				</>
			)}
		</Screen>
	);
}
