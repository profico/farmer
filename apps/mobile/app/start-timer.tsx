import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useAccess } from "../src/api/capabilities";
import { useStartTimer } from "../src/api/queries";
import { useTimerSettings } from "../src/api/time";
import { ProjectPicker, TaskPicker } from "../src/forms/pickers";
import { FormSection, Sheet } from "../src/forms/sheet";
import { formatHours } from "../src/lib/duration";
import { committed } from "../src/time/haptics";
import {
	headStartError,
	headStartLimit,
	stepHeadStart,
} from "../src/time/head-start";
import { ErrorBanner, Field, IconButton, Text } from "../src/ui/components";
import { messageOf } from "../src/ui/errors";
import { usePalette } from "../src/ui/theme";
import { SPACE } from "../src/ui/type";

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
			{/* The head start came with API version 2, as the timer limit did. */}
			{fullApi ? (
				<FormSection label="Timer starts from">
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: SPACE.m,
							backgroundColor: palette.surfaceContainer,
							borderRadius: 16,
							padding: SPACE.s,
						}}
					>
						<IconButton
							icon="minus"
							label="5 minutes less of a head start"
							tone="tonal"
							onPress={() => setHeadStart(stepHeadStart(headStart, -1, limit))}
							disabled={headStart === 0}
						/>
						<View
							style={{ flex: 1, alignItems: "center" }}
							accessible
							accessibilityLabel={`Timer starts from ${formatHours(headStart)}`}
							accessibilityLiveRegion="polite"
						>
							<Text variant="headlineSmall">{formatHours(headStart)}</Text>
						</View>
						<IconButton
							icon="add"
							label="5 minutes more of a head start"
							tone="tonal"
							onPress={() => setHeadStart(stepHeadStart(headStart, 1, limit))}
							disabled={stepHeadStart(headStart, 1, limit) === headStart}
						/>
					</View>
					<Text
						variant="bodySmall"
						color={tooLong ? palette.error : palette.onSurfaceVariant}
					>
						{tooLong ??
							"Time you worked before you started the timer. It counts towards your timer limit."}
					</Text>
				</FormSection>
			) : null}
			<Text variant="bodySmall" color={palette.onSurfaceVariant}>
				Nothing is logged until you stop the timer and save the time.
			</Text>
		</Sheet>
	);
}
