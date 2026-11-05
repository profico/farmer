import type { AbsenceResult } from "@farmer/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Platform } from "react-native";

import { useTasks, useWhoami } from "../../src/api/queries";
import { useLogAbsence } from "../../src/api/you";
import { PickerRow, PickerRows } from "../../src/forms/picker-row";
import {
	FormCluster,
	FormPart,
	FormSection,
	Sheet,
} from "../../src/forms/sheet";
import { addDays } from "../../src/lib/days";
import { formatHours } from "../../src/lib/duration";
import { DateField } from "../../src/time/components/date-field";
import { committed } from "../../src/time/haptics";
import { sumSeconds } from "../../src/time/seconds";
import {
	MAX_SPAN_DAYS,
	skipReasonLabel,
	spanError,
	withFirstDay,
} from "../../src/time/time-off";
import {
	ErrorBanner,
	ErrorState,
	Field,
	Skeleton,
	Text,
} from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { Icon } from "../../src/ui/icon";
import { usePalette } from "../../src/ui/theme";

const longDay = (day: string) =>
	new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		day: "numeric",
		month: "long",
		timeZone: "UTC",
	}).format(new Date(`${day}T12:00:00Z`));

/**
 * Book time off over a range of days, as "I am off from the 4th to the
 * 15th". The server books each working day in the range at the person's own
 * hours, and leaves weekends, public holidays and days already off alone.
 * Half a day is an entry, not a range. When the server skipped a day, the
 * sheet stays open and shows which days and why.
 */
export default function TimeOffSheet() {
	const params = useLocalSearchParams<{ date?: string }>();
	const whoami = useWhoami();
	const start = params.date ?? whoami.data?.today;
	if (!start) {
		return (
			<Sheet
				title="Book time off"
				actionLabel="Book"
				onAction={() => undefined}
				busy
			>
				<Skeleton height={56} radius={16} />
			</Sheet>
		);
	}
	return <TimeOffForm start={start} />;
}

function TimeOffForm({ start }: { start: string }) {
	const palette = usePalette();
	const router = useRouter();
	const tasks = useTasks();
	const book = useLogAbsence();
	const [range, setRange] = useState({ from: start, to: start });
	const [chosen, setChosen] = useState<string | null>(null);
	const [note, setNote] = useState("");
	const [result, setResult] = useState<AbsenceResult | null>(null);

	const absenceTasks = tasks.data?.absenceTasks ?? [];
	// With one kind of time off there is nothing to choose. With two
	// (vacation and sick leave), the person chooses: the app does not guess.
	const taskId =
		chosen ??
		(absenceTasks.length === 1 ? (absenceTasks[0]?.id ?? null) : null);
	const invalid = spanError(range.from, range.to);

	if (result) {
		const bookedSeconds = sumSeconds(result.booked);
		const skippedLabel =
			result.skipped.length === 1
				? "Skipped 1 day"
				: `Skipped ${result.skipped.length} days`;
		return (
			<Sheet
				title="Book time off"
				actionLabel="Done"
				onAction={() => router.back()}
			>
				<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
					This is what went on your timesheet.
				</Text>
				<Text variant="titleMedium">
					{result.booked.length === 0
						? "Nothing was booked."
						: `Booked ${result.booked.length === 1 ? "1 day" : `${result.booked.length} days`}, ${formatHours(bookedSeconds)}.`}
				</Text>
				<FormSection label={skippedLabel} loose>
					<PickerRows title={skippedLabel}>
						{result.skipped.map((day) => (
							<PickerRow
								key={day.date}
								title={longDay(day.date)}
								subtitle={skipReasonLabel(day.reason)}
							/>
						))}
					</PickerRows>
				</FormSection>
			</Sheet>
		);
	}

	const submit = () => {
		if (!taskId || invalid) return;
		book.mutate(
			{
				taskId,
				from: range.from,
				to: range.to,
				description: note.trim() || undefined,
			},
			{
				onSuccess: (data) => {
					committed();
					if (data.skipped.length === 0) router.back();
					else setResult(data);
				},
			},
		);
	};

	return (
		<Sheet
			title="Book time off"
			actionLabel="Book"
			onAction={submit}
			busy={book.isPending}
			actionDisabled={!taskId || invalid !== null}
		>
			{book.error ? (
				<ErrorBanner message={messageOf(book.error) ?? ""} />
			) : null}
			<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
				Choose the first and the last day. Each working day between them is
				booked at your own hours. Public holidays, days you do not work and days
				you already booked are left out.
			</Text>
			<FormSection label="Type" loose>
				{tasks.isPending ? (
					<Skeleton height={56} radius={16} />
				) : tasks.isError ? (
					<ErrorState
						error={tasks.error}
						onRetry={() => void tasks.refetch()}
					/>
				) : absenceTasks.length === 0 ? (
					<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
						This workspace has no absence tasks. An admin adds Vacation and Sick
						Leave in the task settings of the workspace.
					</Text>
				) : (
					<PickerRows title="Type">
						{absenceTasks.map((task) => (
							<PickerRow
								key={task.id}
								title={task.name}
								selected={task.id === taskId}
								onPress={() => setChosen(task.id)}
								trailing={
									task.id === taskId ? (
										<Icon name="check" size={20} color={palette.primary} />
									) : undefined
								}
							/>
						))}
					</PickerRows>
				)}
			</FormSection>
			<FormCluster tight>
				<FormPart footerError groupFooter={invalid ?? undefined}>
					<DateField
						label="First day"
						value={range.from}
						onChange={(from) =>
							setRange((current) => withFirstDay(current, from))
						}
					/>
					<DateField
						label="Last day"
						value={range.to}
						minimum={range.from}
						maximum={addDays(range.from, MAX_SPAN_DAYS)}
						onChange={(to) => setRange((current) => ({ ...current, to }))}
					/>
				</FormPart>
				{invalid && Platform.OS !== "ios" ? (
					<Text variant="bodySmall" color={palette.error}>
						{invalid}
					</Text>
				) : null}
			</FormCluster>
			<Field
				label="Note (optional)"
				value={note}
				onChangeText={setNote}
				placeholder="Anything your team should know"
				multiline
			/>
			<Text variant="bodySmall" color={palette.onSurfaceVariant}>
				For half a day, log an entry on the timesheet. This books whole working
				days.
			</Text>
		</Sheet>
	);
}
