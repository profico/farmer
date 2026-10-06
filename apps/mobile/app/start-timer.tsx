import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import { useAccess } from "../src/api/capabilities";
import { useStartTimer } from "../src/api/queries";
import { useTimerSettings } from "../src/api/time";
import { ProjectPicker, TaskPicker } from "../src/forms/pickers";
import { FormCluster, FormPart, FormSection, Sheet } from "../src/forms/sheet";
import { HeadStartStepper } from "../src/forms/steppers";
import { committed } from "../src/time/haptics";
import { headStartError, headStartLimit } from "../src/time/head-start";
import { ErrorBanner, Field, Text } from "../src/ui/components";
import { messageOf } from "../src/ui/errors";
import { usePalette } from "../src/ui/theme";

/** Start the stopwatch on a project and a task. A timer needs a task; the
 *  project can wait until it is filed. A head start counts time worked
 *  before the timer was started. */
export default function StartTimerSheet() {
	const palette = usePalette();
	const router = useRouter();
	const params = useLocalSearchParams<{ projectId?: string }>();
	const { fullApi } = useAccess();
	const start = useStartTimer();
	const settings = useTimerSettings();
	const [projectId, setProjectId] = useState<string | null>(
		params.projectId ?? null,
	);
	const [taskId, setTaskId] = useState<string | null>(null);
	const [note, setNote] = useState("");
	const [headStart, setHeadStart] = useState(0);
	const limit = headStartLimit(settings.data?.maxSeconds);
	const tooLong = headStartError(headStart, limit);

	const submit = () => {
		if (!taskId || tooLong) return;
		const description = note.trim();
		start.mutate(
			{
				taskId,
				projectId: projectId ?? undefined,
				description: description || undefined,
				headStartSeconds: headStart > 0 ? headStart : undefined,
			},
			{
				onSuccess: () => {
					committed();
					router.back();
				},
			},
		);
	};

	return (
		<Sheet
			title="Start timer"
			actionLabel="Start"
			onAction={submit}
			busy={start.isPending}
			actionDisabled={!taskId || tooLong !== null}
		>
			{start.error ? (
				<ErrorBanner message={messageOf(start.error) ?? ""} />
			) : null}
			<FormCluster>
				<FormPart>
					<ProjectPicker value={projectId} onChange={setProjectId} />
					<TaskPicker value={taskId} onChange={(task) => setTaskId(task.id)} />
				</FormPart>
			</FormCluster>
			<Field
				label="Note"
				value={note}
				onChangeText={setNote}
				placeholder="What are you working on?"
				multiline
			/>
			{/* The head start came with API version 2, as the timer limit did. */}
			{fullApi ? (
				<FormSection
					label="Timer starts from"
					loose
					footer={
						tooLong ??
						"Time you worked before you started the timer. It counts towards your timer limit."
					}
					footerError={tooLong !== null}
				>
					<HeadStartStepper
						seconds={headStart}
						onChange={setHeadStart}
						limit={limit}
					/>
				</FormSection>
			) : null}
			<Text variant="bodySmall" color={palette.onSurfaceVariant}>
				Nothing is logged until you stop the timer and save the time.
			</Text>
		</Sheet>
	);
}
