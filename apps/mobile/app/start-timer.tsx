import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import { useStartTimer } from "../src/api/queries";
import { ProjectPicker, TaskPicker } from "../src/forms/pickers";
import { FormSection, Sheet } from "../src/forms/sheet";
import { ErrorBanner, Field, Text } from "../src/ui/components";
import { messageOf } from "../src/ui/errors";
import { usePalette } from "../src/ui/theme";

/** Start the stopwatch on a project and a task. A timer needs a task; the
 *  project can wait until it is filed. */
export default function StartTimerSheet() {
	const palette = usePalette();
	const router = useRouter();
	const params = useLocalSearchParams<{ projectId?: string }>();
	const start = useStartTimer();
	const [projectId, setProjectId] = useState<string | null>(
		params.projectId ?? null,
	);
	const [taskId, setTaskId] = useState<string | null>(null);
	const [note, setNote] = useState("");

	const submit = () => {
		if (!taskId) return;
		const description = note.trim();
		start.mutate(
			{
				taskId,
				projectId: projectId ?? undefined,
				description: description || undefined,
			},
			{ onSuccess: () => router.back() },
		);
	};

	return (
		<Sheet
			title="Start timer"
			actionLabel="Start"
			onAction={submit}
			busy={start.isPending}
			actionDisabled={!taskId}
		>
			{start.error ? (
				<ErrorBanner message={messageOf(start.error) ?? ""} />
			) : null}
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
				placeholder="What are you working on?"
				multiline
			/>
			<Text variant="bodySmall" color={palette.onSurfaceVariant}>
				Nothing is logged until you stop the timer and save the time.
			</Text>
		</Sheet>
	);
}
