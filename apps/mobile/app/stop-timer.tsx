import type { Timer } from "@farmer/api-client";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import {
	useConfirmTimer,
	useTimer,
	useTimerAction,
	useWhoami,
} from "../src/api/queries";
import { ProjectPicker, TaskPicker } from "../src/forms/pickers";
import { FormSection, Sheet } from "../src/forms/sheet";
import { DayStepper, DurationStepper } from "../src/forms/steppers";
import { dayKeyInTimeZone } from "../src/lib/days";
import { formatStopwatch, toQuarter } from "../src/lib/duration";
import {
	ActionButton,
	Card,
	EmptyState,
	ErrorBanner,
	Field,
	Skeleton,
	Text,
} from "../src/ui/components";
import { messageOf } from "../src/ui/errors";
import { usePalette } from "../src/ui/theme";

/**
 * Stop and log (ADR 0003). The timer is already held when this opens. The
 * figure offered is the server's `snappedSeconds`, the measured time on the
 * nearest quarter hour, and the person can change it before anything is
 * saved. Closing this sheet leaves the timer held.
 */
export default function StopTimerSheet() {
	const timer = useTimer();
	const whoami = useWhoami();

	if (timer.isPending || whoami.isPending) {
		return (
			<Sheet
				title="Stop timer"
				actionLabel="Save"
				onAction={() => undefined}
				busy
			>
				<Skeleton height={96} radius={16} />
			</Sheet>
		);
	}
	const current = timer.data?.timer ?? null;
	if (
		!current ||
		current.droppedAt ||
		!current.organization.here ||
		!whoami.data
	) {
		return (
			<Sheet
				title="Stop timer"
				actionLabel="Save"
				onAction={() => undefined}
				actionDisabled
			>
				<EmptyState
					icon="timer"
					title="No timer to stop here"
					message="It was stopped or discarded somewhere else, or it runs in another workspace."
				/>
			</Sheet>
		);
	}
	return (
		<StopForm
			timer={current}
			today={whoami.data.today}
			timeZone={whoami.data.timezone}
		/>
	);
}

function StopForm({
	timer,
	today,
	timeZone,
}: {
	timer: Timer;
	today: string;
	timeZone: string;
}) {
	const palette = usePalette();
	const router = useRouter();
	const confirm = useConfirmTimer();
	const resume = useTimerAction();
	// A continued entry stays on its own day; a new one lands on the day the
	// timer started, in the workspace's timezone.
	const [date, setDate] = useState(
		timer.entry?.date ?? dayKeyInTimeZone(new Date(timer.startedAt), timeZone),
	);
	const [seconds, setSeconds] = useState(toQuarter(timer.snappedSeconds));
	const [projectId, setProjectId] = useState<string | null>(
		timer.project?.id ?? null,
	);
	const [taskId, setTaskId] = useState(timer.task.id);
	const [note, setNote] = useState(timer.description);
	// The rule is the timer's own task's. Another task's rule is the
	// server's to apply, as `farmer stop -t` leaves it.
	const needsNote = timer.task.needsDescription && taskId === timer.task.id;
	const missingNote = needsNote && !note.trim();
	const failure = messageOf(confirm.error ?? resume.error);

	const save = () => {
		if (missingNote) return;
		confirm.mutate(
			{
				date,
				taskId,
				durationSeconds: seconds,
				// Sent always: on a continued entry an absent project keeps the
				// entry's, and the form holds what the person chose.
				projectId,
				// "" rather than absent, so an emptied note clears the entry's.
				description: note.trim(),
			},
			{ onSuccess: () => router.back() },
		);
	};

	return (
		<Sheet
			title="Stop timer"
			actionLabel="Save"
			onAction={save}
			busy={confirm.isPending || resume.isPending}
			actionDisabled={missingNote}
		>
			{failure ? <ErrorBanner message={failure} /> : null}
			<Card tone="primary">
				<Text variant="labelLarge" color={palette.onPrimaryContainer}>
					Measured
				</Text>
				<Text variant="displaySmall" color={palette.onPrimaryContainer}>
					{formatStopwatch(timer.elapsedSeconds)}
				</Text>
				<Text variant="bodyMedium" color={palette.onPrimaryContainer}>
					{timer.entry
						? "This is the entry's new total, with the time it held before."
						: "Entries are kept in 15-minute steps, so the time below is the measured time on the nearest quarter hour."}
				</Text>
			</Card>
			<FormSection label="Time to log">
				<DurationStepper seconds={seconds} onChange={setSeconds} />
			</FormSection>
			<FormSection label="Day">
				<DayStepper day={date} today={today} onChange={setDate} />
			</FormSection>
			<FormSection label="Project">
				<ProjectPicker value={projectId} onChange={setProjectId} />
			</FormSection>
			<FormSection label="Task">
				<TaskPicker value={taskId} onChange={(task) => setTaskId(task.id)} />
			</FormSection>
			<Field
				label="Note"
				value={note}
				onChangeText={setNote}
				placeholder="What did you work on?"
				multiline
				error={missingNote ? `${timer.task.name} needs a note.` : null}
				hint={needsNote ? `Required on ${timer.task.name}.` : "Optional."}
			/>
			<View style={{ flexDirection: "row" }}>
				<ActionButton
					label="Resume the timer instead"
					variant="text"
					onPress={() =>
						resume.mutate("resume", { onSuccess: () => router.back() })
					}
					disabled={confirm.isPending || resume.isPending}
				/>
			</View>
		</Sheet>
	);
}
