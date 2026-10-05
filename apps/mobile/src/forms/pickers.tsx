import type { Project, Task } from "@farmer/api-client";
import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { useProjects, useTasks } from "../api/queries";
import {
	ErrorState,
	Field,
	ListRow,
	SectionHeader,
	Skeleton,
} from "../ui/components";
import { Icon } from "../ui/icon";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";

/** A chosen value, with the list of the others folded under it. */
function Choice({
	title,
	subtitle,
	open,
	onToggle,
	children,
}: {
	title: string;
	subtitle?: string;
	open: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	const palette = usePalette();
	return (
		<View
			style={{
				borderRadius: 16,
				overflow: "hidden",
				backgroundColor: palette.surfaceContainer,
			}}
		>
			<ListRow
				title={title}
				subtitle={subtitle}
				onPress={onToggle}
				trailing={
					<Icon
						name={open ? "close" : "edit"}
						size={20}
						color={palette.onSurfaceVariant}
					/>
				}
			/>
			{open ? (
				<View
					style={{
						borderTopWidth: 1,
						borderTopColor: palette.outlineVariant,
						paddingBottom: SPACE.s,
					}}
				>
					{children}
				</View>
			) : null}
		</View>
	);
}

const matches = (project: Project, search: string) => {
	const needle = search.trim().toLowerCase();
	if (!needle) return true;
	return [project.name, project.code ?? "", project.client.name].some((text) =>
		text.toLowerCase().includes(needle),
	);
};

/** The projects the person may log to, or none. */
export function ProjectPicker({
	value,
	onChange,
	allowNone = true,
}: {
	value: string | null;
	onChange: (projectId: string | null) => void;
	allowNone?: boolean;
}) {
	const palette = usePalette();
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
	const pick = (projectId: string | null) => {
		onChange(projectId);
		setOpen(false);
		setSearch("");
	};
	const shown = projects.data.filter((project) => matches(project, search));

	return (
		<Choice
			title={chosen?.name ?? "No project"}
			subtitle={chosen?.client.name}
			open={open}
			onToggle={() => setOpen(!open)}
		>
			<View style={{ padding: SPACE.m }}>
				<Field
					label="Search"
					value={search}
					onChangeText={setSearch}
					placeholder="Project, code or client"
					autoCorrect={false}
				/>
			</View>
			{allowNone ? (
				<ListRow
					title="No project"
					subtitle="File it later"
					selected={value === null}
					onPress={() => pick(null)}
				/>
			) : null}
			{shown.map((project) => (
				<ListRow
					key={project.id}
					title={
						project.code ? `${project.name} (${project.code})` : project.name
					}
					subtitle={project.client.name}
					selected={project.id === value}
					onPress={() => pick(project.id)}
					trailing={
						project.id === value ? (
							<Icon name="check" size={20} color={palette.primary} />
						) : undefined
					}
				/>
			))}
		</Choice>
	);
}

const byGroup = (tasks: Task[]) => {
	const groups = new Map<string, Task[]>();
	for (const task of tasks) {
		groups.set(task.group, [...(groups.get(task.group) ?? []), task]);
	}
	return [...groups.entries()];
};

/** The work tasks, by group. With `includeAbsence`, time off too. */
export function TaskPicker({
	value,
	onChange,
	includeAbsence = false,
}: {
	value: string | null;
	onChange: (task: Task) => void;
	includeAbsence?: boolean;
}) {
	const palette = usePalette();
	const tasks = useTasks();
	// Folded until the person opens it, so the list does not push the rest
	// of the form down before a project is chosen.
	const [open, setOpen] = useState(false);

	if (tasks.isPending) return <Skeleton height={56} radius={16} />;
	if (tasks.isError) {
		return (
			<ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
		);
	}
	const all = includeAbsence
		? [...tasks.data.tasks, ...tasks.data.absenceTasks]
		: tasks.data.tasks;
	const chosen = all.find((task) => task.id === value);

	return (
		<Choice
			title={chosen?.name ?? "Choose a task"}
			subtitle={chosen?.group}
			open={open}
			onToggle={() => setOpen(!open)}
		>
			{byGroup(all).map(([group, members]) => (
				<View key={group}>
					<SectionHeader>{group}</SectionHeader>
					{members.map((task) => (
						<ListRow
							key={task.id}
							title={task.name}
							selected={task.id === value}
							onPress={() => {
								onChange(task);
								setOpen(false);
							}}
							trailing={
								task.id === value ? (
									<Icon name="check" size={20} color={palette.primary} />
								) : undefined
							}
						/>
					))}
				</View>
			))}
		</Choice>
	);
}
