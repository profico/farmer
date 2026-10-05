import type { AbsenceResult } from "@farmer/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useTasks, useWhoami } from "../../src/api/queries";
import { useLogAbsence } from "../../src/api/you";
import { FormSection, Sheet } from "../../src/forms/sheet";
import { formatHours } from "../../src/lib/duration";
import {
	ErrorBanner,
	Field,
	ListRow,
	Skeleton,
	Text,
} from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { Icon } from "../../src/ui/icon";
import { usePalette } from "../../src/ui/theme";
import { SPACE } from "../../src/ui/type";
import { DateSetting } from "../../src/you/components/pickers";
import {
	countOf,
	dayMonth,
	skipReasonLabel,
	spanError,
	weekdayOfKey,
} from "../../src/you/format";

const longDay = (key: string) => `${weekdayOfKey(key)}, ${dayMonth(key)}`;

/**
 * Book time off as a span of days. The server books each working day in
 * the span at the person's own hours, and leaves out the public holidays,
 * the days they do not work and the days already booked. Half days are an
 * entry, not a span.
 */
export default function AbsenceSheet() {
	const params = useLocalSearchParams<{ date?: string }>();
	const whoami = useWhoami();
	const day = params.date ?? whoami.data?.today;
	if (!day) {
		return (
			<Sheet title="Book time off" actionLabel="Book" onAction={() => {}} busy>
				<Skeleton height={56} radius={16} />
			</Sheet>
		);
	}
	return <AbsenceForm day={day} />;
}

function AbsenceForm({ day }: { day: string }) {
	const palette = usePalette();
	const router = useRouter();
	const tasks = useTasks();
	const book = useLogAbsence();
	const [taskId, setTaskId] = useState<string | null>(null);
	const [from, setFrom] = useState(day);
	const [to, setTo] = useState(day);
	const [note, setNote] = useState("");
	const [result, setResult] = useState<AbsenceResult | null>(null);

	const absenceTasks = tasks.data?.absenceTasks ?? [];
	// With one absence task there is nothing to choose. With two, Vacation
	// or Sick Leave is the person's choice, not the app's.
	const chosen =
		taskId ??
		(absenceTasks.length === 1 ? (absenceTasks[0]?.id ?? null) : null);
	const span = spanError(from, to);

	if (result) {
		const seconds = result.booked.reduce(
			(sum, booked) => sum + booked.durationSeconds,
			0,
		);
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
						: `Booked ${countOf(result.booked.length, "day")}, ${formatHours(seconds)}`}
				</Text>
				<FormSection label={`Skipped ${countOf(result.skipped.length, "day")}`}>
					<View
						style={{
							borderRadius: 16,
							overflow: "hidden",
							backgroundColor: palette.surfaceContainer,
						}}
					>
						{result.skipped.map((skipped) => (
							<ListRow
								key={skipped.date}
								title={longDay(skipped.date)}
								subtitle={skipReasonLabel(skipped.reason)}
							/>
						))}
					</View>
				</FormSection>
			</Sheet>
		);
	}

	const save = () => {
		if (!chosen || span) return;
		book.mutate(
			{
				taskId: chosen,
				from,
				to,
				description: note.trim() || undefined,
			},
			{
				onSuccess: (data) => {
					// Something was left out: the sheet stays open and says which
					// days and why. Else it closes.
					if (data.skipped.length > 0) setResult(data);
					else router.back();
				},
			},
		);
	};

	return (
		<Sheet
			title="Book time off"
			actionLabel="Book"
			onAction={save}
			busy={book.isPending}
			actionDisabled={!chosen || span !== null}
		>
			<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
				Choose the first and the last day. Each working day between them is
				booked at your own hours. Public holidays, days you do not work and days
				you already booked are left out.
			</Text>
			{book.error ? (
				<ErrorBanner message={messageOf(book.error) ?? ""} />
			) : null}
			<FormSection label="Type">
				{tasks.isPending ? (
					<Skeleton height={56} radius={16} />
				) : tasks.isError ? (
					<ErrorBanner message={messageOf(tasks.error) ?? ""} />
				) : absenceTasks.length === 0 ? (
					<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
						This workspace has no absence tasks. An admin adds Vacation and Sick
						Leave in the settings of the workspace.
					</Text>
				) : (
					<View
						style={{
							borderRadius: 16,
							overflow: "hidden",
							backgroundColor: palette.surfaceContainer,
						}}
					>
						{absenceTasks.map((task) => (
							<ListRow
								key={task.id}
								title={task.name}
								selected={task.id === chosen}
								onPress={() => setTaskId(task.id)}
								trailing={
									task.id === chosen ? (
										<Icon name="check" size={20} color={palette.primary} />
									) : undefined
								}
							/>
						))}
					</View>
				)}
			</FormSection>
			<FormSection label="Days">
				<View
					style={{
						borderRadius: 16,
						overflow: "hidden",
						backgroundColor: palette.surfaceContainer,
						paddingVertical: SPACE.xs,
					}}
				>
					<DateSetting
						title="First day"
						value={from}
						format={longDay}
						onChange={(next) => {
							setFrom(next);
							// A start after the end moves the end with it, so the span
							// never runs backwards.
							if (next > to) setTo(next);
						}}
					/>
					<DateSetting
						title="Last day"
						value={to}
						format={longDay}
						minimum={from}
						onChange={setTo}
					/>
				</View>
				{span ? <ErrorBanner message={span} /> : null}
			</FormSection>
			<Field
				label="Note (optional)"
				value={note}
				onChangeText={setNote}
				placeholder="Summer holiday"
			/>
		</Sheet>
	);
}
