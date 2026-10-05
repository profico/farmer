import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { useAccess } from "../../../src/api/capabilities";
import {
	useArchiveTask,
	useCreateTask,
	useManagedTasks,
	useUpdateTask,
} from "../../../src/api/workspace";
import { FormSection, Sheet } from "../../../src/forms/sheet";
import {
	EmptyState,
	ErrorBanner,
	Field,
	Skeleton,
} from "../../../src/ui/components";
import { messageOf } from "../../../src/ui/errors";
import { Icon } from "../../../src/ui/icon";
import { SettingsSection } from "../../../src/ui/settings-list";
import { usePalette } from "../../../src/ui/theme";
import { SPACE } from "../../../src/ui/type";
import {
	DEFAULT_TASK_COLOR,
	EDITABLE_GROUPS,
	groupOf,
	type TaskGroup,
	TASK_COLORS,
	TASK_GROUP_LABELS,
} from "../../../src/workspace/catalog/task-groups";
import {
	ActionRow,
	ChoiceSection,
	confirmDestructive,
	notifyError,
} from "../../../src/workspace/components";
import { paramOf } from "../../../src/workspace/params";

const NAME_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 500;

const GROUP_OPTIONS = EDITABLE_GROUPS.map((group) => ({
	value: group,
	label: TASK_GROUP_LABELS[group],
}));

/** A new task (no `id`), or the edit of an organization task (`id`). */
export default function TaskSheet() {
	const params = useLocalSearchParams<{ id?: string }>();
	const id = paramOf(params.id);
	const tasks = useManagedTasks();
	const access = useAccess();
	const title = id ? "Edit task" : "New task";

	if (access.ready && !access.isAdmin) {
		return (
			<Sheet
				title={title}
				actionLabel="Save"
				onAction={() => undefined}
				actionDisabled
			>
				<EmptyState
					icon="tasks"
					title="Admins only"
					message="Only an admin can manage the tasks."
				/>
			</Sheet>
		);
	}
	if (!id) {
		return (
			<TaskForm
				id={null}
				name=""
				group="general"
				color={DEFAULT_TASK_COLOR}
				description=""
			/>
		);
	}
	if (tasks.isPending) {
		return (
			<Sheet title={title} actionLabel="Save" onAction={() => undefined} busy>
				<Skeleton height={56} radius={16} />
				<Skeleton height={56} radius={16} />
			</Sheet>
		);
	}
	const task = tasks.data?.find((row) => row.id === id);
	if (!task || task.scope === "site") {
		return (
			<Sheet
				title={title}
				actionLabel="Save"
				onAction={() => undefined}
				actionDisabled
			>
				<EmptyState
					icon="tasks"
					title={task ? "Built-in task" : "This task is gone"}
					message={
						task
							? "A built-in task cannot be changed."
							: "It was changed or removed somewhere else."
					}
				/>
			</Sheet>
		);
	}
	return (
		<TaskForm
			id={task.id}
			name={task.name}
			group={groupOf(task.group) ?? "general"}
			color={task.color ?? DEFAULT_TASK_COLOR}
			description={task.description ?? ""}
		/>
	);
}

function TaskForm({
	id,
	name: initialName,
	group: initialGroup,
	color: initialColor,
	description: initialDescription,
}: {
	id: string | null;
	name: string;
	group: TaskGroup;
	color: string;
	description: string;
}) {
	const router = useRouter();
	const create = useCreateTask();
	const update = useUpdateTask();
	const archive = useArchiveTask();
	const [name, setName] = useState(initialName);
	const [group, setGroup] = useState(initialGroup);
	const [color, setColor] = useState(initialColor);
	const [description, setDescription] = useState(initialDescription);
	const trimmed = name.trim();
	const busy = create.isPending || update.isPending || archive.isPending;
	const failure = messageOf(create.error ?? update.error);

	const save = () => {
		if (trimmed === "") return;
		const body = {
			name: trimmed,
			group,
			color,
			description: description.trim(),
		};
		const done = { onSuccess: () => router.back() };
		if (id) update.mutate({ id, body }, done);
		else create.mutate(body, done);
	};

	const doArchive = () => {
		if (!id) return;
		archive.mutate(
			{ id, archived: true },
			{
				onSuccess: () => router.back(),
				onError: (error) => notifyError("Could not archive the task", error),
			},
		);
	};

	return (
		<Sheet
			title={id ? "Edit task" : "New task"}
			actionLabel={id ? "Save" : "Create"}
			onAction={save}
			busy={busy}
			actionDisabled={trimmed === ""}
		>
			{failure ? <ErrorBanner message={failure} /> : null}
			<FormSection label="Name">
				<Field
					label="Name"
					value={name}
					onChangeText={setName}
					maxLength={NAME_MAX_LENGTH}
					returnKeyType="next"
				/>
			</FormSection>
			<View style={{ marginHorizontal: -SPACE.l }}>
				<ChoiceSection
					title="Group"
					options={GROUP_OPTIONS}
					value={group}
					onChange={setGroup}
				/>
			</View>
			<FormSection label="Colour">
				<ColourChoice value={color} onChange={setColor} />
			</FormSection>
			<FormSection label="Description (optional)">
				<Field
					label="Description"
					value={description}
					onChangeText={setDescription}
					maxLength={DESCRIPTION_MAX_LENGTH}
					multiline
				/>
			</FormSection>
			{id ? (
				<View style={{ marginHorizontal: -SPACE.l }}>
					<SettingsSection footer="Its entries keep the task, so the history stays readable.">
						<ActionRow
							label="Archive task"
							icon="archive"
							destructive
							busy={archive.isPending}
							onPress={() =>
								confirmDestructive({
									title: `Archive ${initialName}?`,
									message:
										"The task leaves the task list. Its entries keep it. You can restore it later.",
									action: "Archive",
									onConfirm: doArchive,
								})
							}
						/>
					</SettingsSection>
				</View>
			) : null}
		</Sheet>
	);
}

/** The colours of the web picker as round swatches. A colour that is not
 *  in the set (a custom colour from the web) shows as one more swatch. */
function ColourChoice({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	const palette = usePalette();
	const known = TASK_COLORS.some(
		(swatch) => swatch.value.toLowerCase() === value.toLowerCase(),
	);
	const swatches = known
		? TASK_COLORS
		: [...TASK_COLORS, { value, label: "Custom colour" }];
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
			{swatches.map((swatch) => {
				const selected = swatch.value.toLowerCase() === value.toLowerCase();
				return (
					<Pressable
						key={swatch.value}
						accessibilityRole="button"
						accessibilityLabel={swatch.label}
						accessibilityState={{ selected }}
						onPress={() => onChange(swatch.value)}
						hitSlop={4}
						style={{
							width: 40,
							height: 40,
							borderRadius: 20,
							alignItems: "center",
							justifyContent: "center",
							backgroundColor: swatch.value,
							borderWidth: selected ? 3 : 0,
							borderColor: palette.onSurface,
						}}
					>
						{selected ? <Icon name="check" size={20} color="#ffffff" /> : null}
					</Pressable>
				);
			})}
		</View>
	);
}
