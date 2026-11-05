import type { Timer } from "@farmer/api-client";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useTimer, useTimerAction, useWhoami } from "../src/api/queries";
import { useConfirmTimerEntry } from "../src/api/time";
import { ProjectPicker, TaskPicker } from "../src/forms/pickers";
import { FormCluster, FormPart, Sheet } from "../src/forms/sheet";
import { DayStepper, DurationStepper } from "../src/forms/steppers";
import { formatStopwatch } from "../src/lib/duration";
import { committed, toggled } from "../src/time/haptics";
import {
	type StopEdits,
	stopFormFields,
	stopPayload,
	timerStopFields,
} from "../src/time/stop-fields";
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
 * Stop and log (ADR 0003). The in-app Stop holds the timer before it opens
 * this sheet. A link from a timer surface does not: it only opens the sheet,
 * and the timer keeps running until the person saves. The figure offered is
 * the server's `snappedSeconds`, the measured time on the nearest quarter
 * hour, and the person can change it before anything is saved.
 */
export default function StopTimerSheet() {
	const timer = useTimer({ fresh: true });
	const whoami = useWhoami();
	// The timer as the person saved it. The save clears the cached timer
	// while the sheet closes, and the form stays on screen until it is gone.
	const [saved, setSaved] = useState<Timer | null>(null);

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
	const current = saved ?? timer.data?.timer ?? null;
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
			refreshing={timer.isFetching && saved === null}
			onSaved={() => setSaved(current)}
		/>
	);
}

function StopForm({
	timer,
	today,
	timeZone,
	refreshing,
	onSaved,
}: {
	timer: Timer;
	today: string;
	timeZone: string;
	/** The timer is being read again. The cached figure can be minutes old
	 *  when a notification opened this sheet, and Save logs the figure shown. */
	refreshing: boolean;
	onSaved: () => void;
}) {
	const palette = usePalette();
	const router = useRouter();
	const confirm = useConfirmTimerEntry({
		onSaved: () => {
			committed();
			onSaved();
			router.back();
		},
	});
	const resume = useTimerAction();
	// Only what the person changed is kept here. Every other field follows
	// the live timer, so a refetch brings in a note edited on the entry.
	const [edits, setEdits] = useState<StopEdits>({});
	const live = timerStopFields(timer, timeZone);
	const {
		date,
		seconds,
		projectId,
		taskId,
		description: note,
	} = stopFormFields(live, edits);
	const edit = (patch: StopEdits) => setEdits((e) => ({ ...e, ...patch }));
	// The rule is the timer's own task's. Another task's rule is the
	// server's to apply, as `farmer stop -t` leaves it.
	const needsNote = timer.task.needsDescription && taskId === timer.task.id;
	const missingNote = needsNote && !note.trim();
	const failure = messageOf(confirm.error ?? resume.error);

	const hint = needsNote ? `Required on ${timer.task.name}.` : "Optional.";
	const noteFooter = missingNote ? `${timer.task.name} needs a note.` : hint;

	const save = () => {
		if (missingNote || refreshing) return;
		confirm.mutate(stopPayload({ timer, live, edits }));
	};

	return (
		<Sheet
			title="Stop timer"
			actionLabel="Save"
			onAction={save}
			busy={confirm.isPending || resume.isPending}
			actionDisabled={missingNote || refreshing}
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
						: "Entries are kept in 15-minute steps, so the time below is the measured time on the nearest quarter hour, and at least 0:15."}
				</Text>
			</Card>
			<FormCluster>
				<FormPart label="Time to log">
					<DurationStepper
						label="Time to log"
						seconds={seconds}
						onChange={(seconds) => edit({ seconds })}
					/>
				</FormPart>
				<FormPart label="Day">
					<DayStepper
						label="Day"
						day={date}
						today={today}
						onChange={(date) => edit({ date })}
					/>
				</FormPart>
			</FormCluster>
			<FormCluster>
				<FormPart>
					<ProjectPicker
						value={projectId}
						onChange={(projectId) => edit({ projectId })}
					/>
					<TaskPicker
						value={taskId}
						onChange={(task) => edit({ taskId: task.id })}
					/>
				</FormPart>
			</FormCluster>
			<FormCluster>
				<FormPart footerError={missingNote} groupFooter={noteFooter}>
					<Field
						label="Note"
						value={note}
						onChangeText={(description) => edit({ description })}
						placeholder="What did you work on?"
						multiline
						error={missingNote ? `${timer.task.name} needs a note.` : null}
						hint={hint}
					/>
				</FormPart>
			</FormCluster>
			<View style={{ flexDirection: "row" }}>
				<ActionButton
					label="Resume the timer instead"
					variant="text"
					onPress={() =>
						resume.mutate("resume", {
							onSuccess: () => {
								toggled();
								router.back();
							},
						})
					}
					disabled={confirm.isPending || resume.isPending}
				/>
			</View>
		</Sheet>
	);
}
