import { Switch } from "@expo/ui";
import type { RecurringBlock, Task } from "@farmer/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { useTasks, useWhoami } from "../../src/api/queries";
import {
	useCreateRecurringBlock,
	useRecurringBlocks,
	useUpdateRecurringBlock,
} from "../../src/api/you";
import { ProjectPicker, TaskPicker } from "../../src/forms/pickers";
import { FormSection, Sheet } from "../../src/forms/sheet";
import { DurationStepper } from "../../src/forms/steppers";
import { formatHours } from "../../src/lib/duration";
import {
	ActionButton,
	EmptyState,
	ErrorBanner,
	Field,
	Skeleton,
	Text,
} from "../../src/ui/components";
import { messageOf } from "../../src/ui/errors";
import { ControlHost } from "../../src/ui/host";
import { usePalette } from "../../src/ui/theme";
import { SPACE } from "../../src/ui/type";
import { WeekdayChips } from "../../src/you/components/weekday-chips";
import { useConfirmDeleteBlock } from "../../src/you/confirm-delete";
import { descriptionRequiredFor } from "../../src/you/format";

/** Add a recurring block, or change one (`id`). */
export default function RecurringBlockSheet() {
	const { id } = useLocalSearchParams<{ id?: string }>();
	const blocks = useRecurringBlocks();
	const title = id ? "Edit recurring block" : "New recurring block";

	if (!id) return <BlockForm block={null} />;
	if (blocks.isPending) {
		return (
			<Sheet title={title} actionLabel="Save" onAction={() => {}} busy>
				<Skeleton height={56} radius={16} />
				<Skeleton height={56} radius={16} />
			</Sheet>
		);
	}
	const block = blocks.data?.find((row) => row.id === id);
	if (!block) {
		return (
			<Sheet
				title={title}
				actionLabel="Save"
				onAction={() => {}}
				actionDisabled
			>
				{blocks.error ? (
					<ErrorBanner message={messageOf(blocks.error) ?? ""} />
				) : (
					<EmptyState
						icon="repeat"
						title="This block is gone"
						message="It was changed or removed somewhere else."
					/>
				)}
			</Sheet>
		);
	}
	return <BlockForm block={block} />;
}

function BlockForm({ block }: { block: RecurringBlock | null }) {
	const palette = usePalette();
	const router = useRouter();
	const whoami = useWhoami();
	const tasks = useTasks();
	const create = useCreateRecurringBlock();
	const update = useUpdateRecurringBlock();
	const remove = useConfirmDeleteBlock();

	const [projectId, setProjectId] = useState(block?.project?.id ?? null);
	const [taskId, setTaskId] = useState(block?.task.id ?? null);
	const [days, setDays] = useState(block?.daysOfWeek ?? [1, 2, 3, 4, 5]);
	const [seconds, setSeconds] = useState(block?.durationSeconds ?? 1800);
	const [note, setNote] = useState(block?.description ?? "");
	const [active, setActive] = useState(block?.active ?? true);
	const [tried, setTried] = useState(false);

	const allTasks: Task[] = tasks.data
		? [...tasks.data.tasks, ...tasks.data.absenceTasks]
		: [];
	const task = allTasks.find((row) => row.id === taskId);
	// Until the tasks load, the note counts as needed, as on the web.
	const needsNote = task ? descriptionRequiredFor(task) : true;
	const problem = !taskId
		? "Choose a task."
		: days.length === 0
			? "Choose at least one day."
			: needsNote && !note.trim()
				? "This task needs a note."
				: null;

	const busy = create.isPending || update.isPending || remove.pending;
	const failure = messageOf(create.error ?? update.error ?? remove.error);

	const save = () => {
		setTried(true);
		if (problem || !taskId) return;
		const done = { onSuccess: () => router.back() };
		const duration = formatHours(seconds);
		if (!block) {
			create.mutate(
				{
					taskId,
					projectId: projectId ?? undefined,
					description: note.trim() || undefined,
					daysOfWeek: days,
					duration,
				},
				done,
			);
			return;
		}
		update.mutate(
			{
				id: block.id,
				patch: {
					taskId,
					// Null takes the project away; undefined would keep it.
					projectId,
					description: note.trim(),
					daysOfWeek: days,
					duration,
					active,
				},
			},
			done,
		);
	};

	const confirmDelete = () => {
		if (block) remove.confirm(block, () => router.back());
	};

	return (
		<Sheet
			title={block ? "Edit recurring block" : "New recurring block"}
			actionLabel={block ? "Save" : "Create"}
			onAction={save}
			busy={busy}
		>
			{failure ? <ErrorBanner message={failure} /> : null}
			{tried && problem ? <ErrorBanner message={problem} /> : null}
			<ProjectPicker value={projectId} onChange={setProjectId} />
			<TaskPicker
				value={taskId}
				includeAbsence
				onChange={(next) => setTaskId(next.id)}
			/>
			<FormSection label="Days">
				<WeekdayChips
					value={days}
					onChange={setDays}
					weekStartsOn={whoami.data?.weekStartsOn ?? 1}
				/>
			</FormSection>
			<FormSection label="Duration">
				<DurationStepper seconds={seconds} onChange={setSeconds} />
			</FormSection>
			<Field
				label={needsNote ? "Note" : "Note (optional)"}
				hint="Each entry the block writes gets this note."
				value={note}
				onChangeText={setNote}
				placeholder="What is the time for?"
			/>
			{block ? (
				<Pressable
					accessible
					accessibilityRole="switch"
					accessibilityLabel="On"
					accessibilityHint="A paused block writes nothing until you turn it on again."
					accessibilityState={{ checked: active }}
					onPress={() => setActive(!active)}
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: SPACE.m,
						backgroundColor: palette.surfaceContainer,
						borderRadius: 16,
						padding: SPACE.l,
					}}
				>
					<View style={{ flex: 1 }}>
						<Text variant="bodyLarge">On</Text>
						<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
							A paused block writes nothing until you turn it on again.
						</Text>
					</View>
					<ControlHost>
						<Switch value={active} onValueChange={setActive} />
					</ControlHost>
				</Pressable>
			) : null}
			{block ? (
				<View style={{ flexDirection: "row" }}>
					<ActionButton
						label="Delete block"
						variant="text"
						onPress={confirmDelete}
						disabled={busy}
					/>
				</View>
			) : null}
		</Sheet>
	);
}
