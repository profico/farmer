import type { Task } from "@farmer/api-client";
import { useState } from "react";
import { View } from "react-native";

import { useProjects, useTasks } from "../api/queries";
import { useHiddenTasks } from "../api/you";
import { ProjectMark } from "../projects/components/project-mark";
import { ErrorState, Skeleton } from "../ui/components";
import { Icon } from "../ui/icon";
import { usePalette } from "../ui/theme";
import { PickerField } from "./picker-field";
import {
	offeredTasks,
	projectSections,
	taskSections,
	type ProjectItem,
} from "./picker-model";
import { PickerRow } from "./picker-row";
import { PickerScreen } from "./picker-screen";

/** The check at the end of the chosen row. */
function Chosen() {
	const palette = usePalette();
	return <Icon name="check" size={20} color={palette.primary} />;
}

/** The projects the person may log to, or none. A field in the form opens a
 *  full-screen list with a search, as a big organization has many projects. */
export function ProjectPicker({
	value,
	onChange,
	allowNone = true,
}: {
	value: string | null;
	onChange: (projectId: string | null) => void;
	allowNone?: boolean;
}) {
	const projects = useProjects();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	if (projects.isPending) return <Skeleton height={56} radius={16} />;
	if (projects.isError) {
		return (
			<ErrorState
				error={projects.error}
				onRetry={() => void projects.refetch()}
			/>
		);
	}
	const chosen = projects.data.find((project) => project.id === value);
	const close = () => {
		setOpen(false);
		setSearch("");
	};
	const pick = (projectId: string | null) => {
		onChange(projectId);
		close();
	};
	const renderItem = (item: ProjectItem) => {
		if (item.kind === "none") {
			return (
				<PickerRow
					title="No project"
					subtitle="File it later"
					selected={value === null}
					onPress={() => pick(null)}
					trailing={value === null ? <Chosen /> : undefined}
				/>
			);
		}
		const { project } = item;
		return (
			<PickerRow
				leading={
					<ProjectMark icon={project.icon ?? null} name={project.name} />
				}
				title={
					project.code ? `${project.name} (${project.code})` : project.name
				}
				subtitle={project.client.name}
				selected={project.id === value}
				onPress={() => pick(project.id)}
				trailing={project.id === value ? <Chosen /> : undefined}
			/>
		);
	};

	return (
		<View>
			<PickerField
				label="Project"
				leading={
					chosen ? (
						<ProjectMark icon={chosen.icon ?? null} name={chosen.name} />
					) : undefined
				}
				title={chosen?.name ?? "No project"}
				subtitle={chosen?.client.name}
				empty={!chosen}
				onPress={() => setOpen(true)}
			/>
			<PickerScreen
				visible={open}
				onClose={close}
				title="Project"
				label="Search projects"
				placeholder="Search projects"
				search={search}
				onSearch={setSearch}
				sections={projectSections(projects.data, search, allowNone)}
				keyExtractor={(item) =>
					item.kind === "none" ? "none" : item.project.id
				}
				renderItem={renderItem}
				emptyTitle="No project matches"
			/>
		</View>
	);
}

/** The work tasks, by group. With `includeAbsence`, time off too. The tasks
 *  that the person hid in "Your tasks" do not show, but the chosen task
 *  always shows, as in the task picker of the web app. */
export function TaskPicker({
	value,
	onChange,
	includeAbsence = false,
}: {
	value: string | null;
	onChange: (task: Task) => void;
	includeAbsence?: boolean;
}) {
	const tasks = useTasks();
	const hidden = useHiddenTasks();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	if (tasks.isPending) return <Skeleton height={56} radius={16} />;
	if (tasks.isError) {
		return (
			<ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
		);
	}
	// Before the hidden list arrives, every task shows.
	const hiddenIds = new Set(hidden.data?.taskIds);
	const offered = offeredTasks(
		tasks.data.tasks,
		tasks.data.absenceTasks,
		hiddenIds,
		value,
		includeAbsence,
	);
	const chosen = offered.find((task) => task.id === value);
	const close = () => {
		setOpen(false);
		setSearch("");
	};

	return (
		<View>
			<PickerField
				label="Task"
				title={chosen?.name ?? "Choose a task"}
				subtitle={chosen?.group}
				empty={!chosen}
				onPress={() => setOpen(true)}
			/>
			<PickerScreen
				visible={open}
				onClose={close}
				title="Task"
				label="Search tasks"
				placeholder="Search tasks"
				search={search}
				onSearch={setSearch}
				sections={taskSections(offered, search)}
				keyExtractor={(task) => task.id}
				renderItem={(task) => (
					<PickerRow
						title={task.name}
						selected={task.id === value}
						onPress={() => {
							onChange(task);
							close();
						}}
						trailing={task.id === value ? <Chosen /> : undefined}
					/>
				)}
				emptyTitle="No task matches"
			/>
		</View>
	);
}
